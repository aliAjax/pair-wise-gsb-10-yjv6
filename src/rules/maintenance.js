// 判定规则层：纯函数，无界面、无存储依赖。
// 所有维护批次的业务判定（交叠、备用链路、冻结、可达性、回退）集中在此。

export const BATCH_STATUS = {
  REGISTERED: 'registered', // 已登记，等待开始
  ACTIVE: 'active',         // 维护中：设备与相关链路已冻结
  COMPLETED: 'completed',   // 结束并复核通过
  ROLLED_BACK: 'rolled_back' // 复核失败，已恢复冻结前快照
};

export const STATUS_LABEL = {
  registered: '已登记',
  active: '维护中',
  completed: '已完成',
  rolled_back: '已回退'
};

export const TYPE_META = {
  router: { icon: '◉', label: '路由器' },
  switch: { icon: '▦', label: '交换机' },
  server: { icon: '▣', label: '服务器' },
  device: { icon: '▱', label: '终端设备' }
};

// —— 基础拓扑工具 ——

export const findNode = (topo, id) => topo.nodes.find((n) => n.id === id);

export const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const sameEdge = (e1, e2) => edgeKey(e1[0], e1[1]) === edgeKey(e2[0], e2[1]);

export const hasEdge = (edges, a, b) => edges.some((e) => sameEdge(e, [a, b]));

export const edgesTouching = (edges, nodeIds) => {
  const set = new Set(nodeIds);
  return edges.filter(([a, b]) => set.has(a) || set.has(b));
};

export const isCoreRouter = (topo, nodeId) => {
  const n = findNode(topo, nodeId);
  return !!n && n.type === 'router';
};

// 无向图 BFS：从某设备出发是否能到达任意一台核心路由器（type === 'router'）。
export function canReachCoreRouter(topology, startId) {
  if (!findNode(topology, startId)) return false;
  if (isCoreRouter(topology, startId)) return true;
  const adj = new Map();
  for (const n of topology.nodes) adj.set(n.id, []);
  for (const [a, b] of topology.edges) {
    if (!adj.has(a) || !adj.has(b)) continue;
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    for (const next of adj.get(id) || []) {
      if (seen.has(next)) continue;
      if (isCoreRouter(topology, next)) return true;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

// 时段交叠：半开区间 [start, end)，首尾相接不算交叠。
export function windowsOverlap(w1, w2) {
  return w1.start < w2.end && w2.start < w1.end;
}

// 批次占用的设备集合（登记设备 ∪ 备用链路两端）。
export function batchOccupiedNodes(batch) {
  const ids = new Set(batch.deviceIds || []);
  if (batch.backupLink && batch.backupLink[0] && batch.backupLink[1]) {
    ids.add(batch.backupLink[0]);
    ids.add(batch.backupLink[1]);
  }
  return [...ids];
}

// —— 登记校验：整批拒绝（保留原图）的两类硬性规则 ——
// 返回 { ok: true } 或 { ok: false, errors: [...] }。
export function validateBatchDraft(draft, topology, batches, activeId) {
  const errors = [];
  const deviceIds = [...(draft.deviceIds || [])];

  if (!String(draft.owner || '').trim()) errors.push('必须填写责任人');
  if (!draft.window || !draft.window.start || !draft.window.end) {
    errors.push('必须填写完整的维护时段（开始与结束）');
  } else if (draft.window.start >= draft.window.end) {
    errors.push('维护时段开始时间必须早于结束时间');
  }

  if (deviceIds.length === 0) {
    errors.push('批次至少要登记一台设备');
  }
  for (const id of deviceIds) {
    if (!findNode(topology, id)) errors.push(`设备 ${id} 不在当前拓扑中`);
  }
  const dup = deviceIds.filter((id, i) => deviceIds.indexOf(id) !== i);
  if (dup.length) errors.push(`设备重复登记：${[...new Set(dup)].join('、')}`);

  // 备用链路：填写了就必须两端都存在、互不相同，且是一条新链路（不能与现有链路重合）。
  let backup = null;
  const bl = draft.backupLink;
  if (bl && ((bl[0] && !bl[1]) || (!bl[0] && bl[1]))) {
    errors.push('备用链路需要同时选择两端设备');
  } else if (bl && bl[0] && bl[1]) {
    if (!findNode(topology, bl[0]) || !findNode(topology, bl[1])) {
      errors.push('备用链路端点不在当前拓扑中');
    } else if (bl[0] === bl[1]) {
      errors.push('备用链路两端不能是同一台设备');
    } else if (hasEdge(topology.edges, bl[0], bl[1])) {
      errors.push('备用链路与现有链路重合，没有冗余意义');
    } else {
      backup = [bl[0], bl[1]];
    }
  }

  // 规则一：批次涉及核心路由器时，必须提供备用链路。
  const touchesCore = deviceIds.some((id) => isCoreRouter(topology, id));
  if (touchesCore && !backup) {
    errors.push('批次涉及核心路由器，必须登记备用链路，否则整批拒绝');
  }

  // 规则二：与尚未结束的批次（已登记 / 维护中）在设备或时段上交叠即整批拒绝。
  if (draft.window && draft.window.start && draft.window.end) {
    for (const b of batches) {
      if (b.status !== BATCH_STATUS.REGISTERED && b.status !== BATCH_STATUS.ACTIVE) continue;
      if (b.id === activeId) continue;
      if (!windowsOverlap(draft.window, b.window)) continue;
      const busy = batchOccupiedNodes(b);
      const hit = busy.filter((id) => deviceIds.includes(id) ||
        (backup && (id === backup[0] || id === backup[1])));
      if (hit.length) {
        const names = hit.map((id) => findNode(topology, id)?.name || id).join('、');
        errors.push(`维护时段与批次 ${b.code} 交叠，且冲突设备：${names}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, backup };
}

// —— 冻结规则：维护中批次锁定登记设备及其全部相关链路 ——

export function lockedNodeIds(activeBatch) {
  return new Set(activeBatch ? activeBatch.deviceIds || [] : []);
}

export function frozenEdgeSet(activeBatch) {
  if (!activeBatch || !activeBatch.snapshot) return new Set();
  const set = lockedNodeIds(activeBatch);
  return new Set(
    activeBatch.snapshot.edges
      .filter(([a, b]) => set.has(a) || set.has(b))
      .map(([a, b]) => edgeKey(a, b))
  );
}

// 界面操作守卫：返回 null 表示允许，否则返回拒绝原因。
export function guardNodeEdit(activeBatch, nodeId) {
  if (activeBatch && (activeBatch.deviceIds || []).includes(nodeId)) {
    return `设备处于批次 ${activeBatch.code} 的维护冻结中，禁止修改属性或移除设备`;
  }
  return null;
}

export function guardNodeRemove(activeBatch, topology, nodeId) {
  const direct = guardNodeEdit(activeBatch, nodeId);
  if (direct) return direct;
  if (activeBatch) {
    const locked = new Set(activeBatch.deviceIds || []);
    const touches = topology.edges.some(([a, b]) =>
      (a === nodeId && locked.has(b)) || (b === nodeId && locked.has(a)));
    if (touches) return `该设备与批次 ${activeBatch.code} 的冻结链路相连，维护期间不能移除`;
  }
  return null;
}

export function guardEdgeChange(activeBatch, a, b) {
  if (!activeBatch) return null;
  const frozen = frozenEdgeSet(activeBatch);
  if (frozen.has(edgeKey(a, b))) {
    return `该链路属于批次 ${activeBatch.code} 的冻结范围，维护期间不能改动`;
  }
  return null;
}

// —— 结束前复核：逐设备检查可达核心路由器 ——
// 返回 { pass, unreachable: [{id,name}] }
export function verifyReachability(activeBatch, topology) {
  const unreachable = (activeBatch.deviceIds || [])
    .map((id) => ({ id, name: findNode(topology, id)?.name || id }))
    .filter(({ id }) => !canReachCoreRouter(topology, id));
  return { pass: unreachable.length === 0, unreachable };
}
