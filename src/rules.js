// 判定规则层：全部为纯函数，不接触 React / localStorage。
// 界面与资料层只调用这里的规则，不自行解释判定。

export const STATUS = {
  REGISTERED: 'registered',
  ACTIVE: 'active',
  DONE: 'done',
  ROLLED_BACK: 'rolled_back',
};

export const STATUS_LABEL = {
  registered: '待开始',
  active: '维护中',
  done: '已完成',
  rolled_back: '已回退',
};

// 设备 id 与核心路由器类型的判定口径：type === 'router' 即为核心路由器。
export const CORE_TYPE = 'router';

export const isCoreRouter = (node) => !!node && node.type === CORE_TYPE;

export const findCoreRouters = (topo) => topo.nodes.filter(isCoreRouter);

// 无向边的稳定键，用于边去重 / 冻结边比对。
export const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// 维护时段交叠：同一设备不能同时出现在两个交叠时段的批次里。
export function windowsOverlap(a, b) {
  return new Date(a.start).getTime() < new Date(b.end).getTime()
    && new Date(b.start).getTime() < new Date(a.end).getTime();
}

// 登记批次：通过返回 { ok:true, batch }；整批拒绝返回 { ok:false, reasons:[...] }。
// 任意一条规则不满足都整批拒绝，调用方不得保留该批次。
export function validateRegistration(input, topo, batches) {
  const reasons = [];
  const name = (input.name || '').trim();
  const owner = (input.owner || '').trim();
  const start = new Date(input.start).getTime();
  const end = new Date(input.end).getTime();
  const deviceIds = input.deviceIds || [];
  const backups = input.backups || [];
  const nodeIds = new Set(topo.nodes.map((n) => n.id));

  if (!name) reasons.push('批次名称不能为空');
  if (!owner) reasons.push('责任人不能为空');
  if (deviceIds.length === 0) reasons.push('批次至少要登记一台设备');
  if (deviceIds.length !== new Set(deviceIds).size)
    reasons.push('批次内存在重复登记的设备');
  deviceIds.forEach((id) => {
    if (!nodeIds.has(id)) reasons.push(`设备 ${id} 不在当前拓扑中`);
  });
  if (Number.isNaN(start) || Number.isNaN(end))
    reasons.push('维护时段格式不正确');
  else if (start >= end) reasons.push('维护结束时间必须晚于开始时间');

  // 备用链路：引用的两台设备必须真实存在、不能自环、不能重复。
  const backupKeys = new Set();
  backups.forEach((link, i) => {
    const a = (link.a || '').trim();
    const b = (link.b || '').trim();
    if (!a || !b) return reasons.push(`备用链路 ${i + 1} 两端设备未填写完整`);
    if (!nodeIds.has(a)) return reasons.push(`备用链路 ${i + 1}：设备 ${a} 不存在`);
    if (!nodeIds.has(b)) return reasons.push(`备用链路 ${i + 1}：设备 ${b} 不存在`);
    if (a === b) return reasons.push(`备用链路 ${i + 1} 不能把设备连到自身`);
    const key = edgeKey(a, b);
    if (backupKeys.has(key)) return reasons.push(`备用链路 ${i + 1} 与前面的备用链路重复`);
    backupKeys.add(key);
  });

  // 涉及核心路由器的批次必须登记至少一条备用链路。
  const includesCore = topo.nodes.some(
    (n) => deviceIds.includes(n.id) && isCoreRouter(n),
  );
  if (includesCore && backups.length === 0)
    reasons.push('批次涉及核心路由器，必须登记备用链路');

  // 设备时段交叠：与已登记/进行中的批次在同一设备、同一时间段冲突。
  if (!Number.isNaN(start) && start < end) {
    const window = { start: input.start, end: input.end };
    batches
      .filter((b) => b.status === STATUS.REGISTERED || b.status === STATUS.ACTIVE)
      .forEach((b) => {
        if (
          windowsOverlap(window, b)
          && b.deviceIds.some((id) => deviceIds.includes(id))
        ) {
          const shared = b.deviceIds.filter((id) => deviceIds.includes(id));
          reasons.push(
            `与批次「${b.name}」维护时段交叠，冲突设备：${shared.join('、')}`,
          );
        }
      });
  }

  if (reasons.length) return { ok: false, reasons };

  return {
    ok: true,
    batch: {
      id: input.id || `batch-${Date.now()}`,
      name,
      owner,
      start: input.start,
      end: input.end,
      deviceIds: [...deviceIds],
      backups: backups.map((l) => [l.a.trim(), l.b.trim()]),
      status: STATUS.REGISTERED,
      createdAt: input.createdAt || new Date().toISOString(),
      snapshot: null,
      startedAt: null,
      finishedAt: null,
      failReason: null,
    },
  };
}

// —— 维护期冻结规则 ——

export const getActiveBatch = (batches) =>
  batches.find((b) => b.status === STATUS.ACTIVE) || null;

// 维护批次内的设备全部冻结。
export const lockedNodeIds = (batch) =>
  new Set(batch && batch.status === STATUS.ACTIVE ? batch.deviceIds : []);

// 与冻结设备相关的链路全部冻结。
export const frozenEdgeKeys = (batch) => {
  const locked = lockedNodeIds(batch);
  const keys = new Set();
  if (!batch) return keys;
  // 维护开始时存在于拓扑、且任一端是批次设备的边
  (batch.snapshot?.edges || []).forEach(([a, b]) => {
    if (locked.has(a) || locked.has(b)) keys.add(edgeKey(a, b));
  });
  return keys;
};

// 改设备属性（名称/IP/类型/位置）被冻结时返回原因，否则 null。
export const nodeEditBlocked = (nodeId, activeBatch) => {
  if (activeBatch && lockedNodeIds(activeBatch).has(nodeId))
    return `设备处于批次「${activeBatch.name}」维护冻结中，属性不可修改`;
  return null;
};

// 移除设备：冻结设备本身禁止移除；非冻结设备若挂着冻结链路，
// 移除它会连带删除相关链路，同样禁止（防止借删除邻居绕开链路冻结）。
export const nodeRemovalBlocked = (nodeId, topo, activeBatch) => {
  if (!activeBatch) return null;
  if (lockedNodeIds(activeBatch).has(nodeId))
    return `设备处于批次「${activeBatch.name}」维护冻结中，禁止移除设备`;
  const touchesFrozen = (topo?.edges || []).some(
    ([a, b]) =>
      (a === nodeId || b === nodeId)
      && (lockedNodeIds(activeBatch).has(a) || lockedNodeIds(activeBatch).has(b)),
  );
  if (touchesFrozen)
    return `该设备连接着批次「${activeBatch.name}」的冻结设备，维护期内移除会破坏冻结链路`;
  return null;
};

// 链路改动（新建/删除）：任一端是冻结设备即视为相关链路，禁止改动。
export const edgeChangeBlocked = (a, b, activeBatch) => {
  if (!activeBatch) return null;
  if (lockedNodeIds(activeBatch).has(a) || lockedNodeIds(activeBatch).has(b))
    return `该链路关联批次「${activeBatch.name}」的冻结设备，维护期内禁止改动`;
  return null;
};

// —— 结束前回退核对 ——

// 无向图上从 start 出发，能到达任一核心路由器即视为可达成核心。
export function reachabilityCheck(topo, deviceIds) {
  const core = findCoreRouters(topo);
  if (core.length === 0)
    return { ok: false, unreachable: [...deviceIds], reason: '当前拓扑中不存在核心路由器' };

  const adj = new Map();
  topo.nodes.forEach((n) => adj.set(n.id, new Set()));
  topo.edges.forEach(([a, b]) => {
    if (!adj.has(a) || !adj.has(b)) return;
    adj.get(a).add(b);
    adj.get(b).add(a);
  });
  const coreIds = new Set(core.map((n) => n.id));

  const unreachable = [];
  deviceIds.forEach((id) => {
    if (!adj.has(id)) {
      unreachable.push(id);
      return;
    }
    const seen = new Set([id]);
    const queue = [id];
    let hit = coreIds.has(id);
    while (queue.length && !hit) {
      const cur = queue.shift();
      adj.get(cur).forEach((next) => {
        if (seen.has(next)) return;
        seen.add(next);
        if (coreIds.has(next)) hit = true;
        queue.push(next);
      });
    }
    if (!hit) unreachable.push(id);
  });

  if (!unreachable.length) return { ok: true, unreachable: [] };

  const nameOf = (id) => topo.nodes.find((n) => n.id === id)?.name || id;
  return {
    ok: false,
    unreachable,
    reason: `复核失败：设备 ${unreachable
      .map(nameOf)
      .join('、')} 无法到达核心路由器，已恢复维护开始前的冻结快照`,
  };
}
