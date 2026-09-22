// 维护批次状态层：批次生命周期动作（纯函数）+ localStorage 持久化。
// 不在此处做任何界面渲染；判定全部委托 rules/maintenance.js。
import { useCallback, useEffect, useState } from 'react';
import {
  BATCH_STATUS,
  validateBatchDraft,
  verifyReachability
} from '../rules/maintenance.js';

const STORE_KEY = 'maintenanceBatches';
const SNAPSHOT_KEY = 'maintenanceSnapshot';

const emptyStore = { batches: [], activeId: null };

export function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && Array.isArray(raw.batches)) {
      return { batches: raw.batches, activeId: raw.activeId || null };
    }
  } catch { /* 落库损坏时从空状态启动 */ }
  return emptyStore;
}

// 活动批次的冻结快照单独存放：刷新页面后锁定与快照仍一致。
export function loadSnapshot() {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_KEY)) || null;
  } catch {
    return null;
  }
}

function persist(batches, activeId, snapshot) {
  // 快照体积等于整张拓扑，只存独立 key，不随批次记录重复落盘。
  const lean = batches.map((b) => {
    const { snapshot: _omit, ...rest } = b;
    return rest;
  });
  localStorage.setItem(STORE_KEY, JSON.stringify({ batches: lean, activeId }));
  if (snapshot) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  else localStorage.removeItem(SNAPSHOT_KEY);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

let seq = 0;
const nextId = () => {
  seq += 1;
  return `b${Date.now()}${seq}`;
};
const codeOf = (id) => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `MB-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${id.slice(-4)}`;
};

// —— 纯动作 ——

// 登记：校验不通过则整批拒绝，不写入任何批次，也不动拓扑。
export function registerBatch(input) {
  const result = validateBatchDraft(input.draft, input.topology, input.batches, input.activeId);
  if (!result.ok) return { ok: false, errors: result.errors };
  const id = nextId();
  const batch = {
    id,
    code: codeOf(id),
    name: String(input.draft.name || '').trim() || '未命名维护批次',
    deviceIds: [...input.draft.deviceIds],
    window: { start: input.draft.window.start, end: input.draft.window.end },
    owner: String(input.draft.owner).trim(),
    backupLink: result.backup,
    status: BATCH_STATUS.REGISTERED,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    reason: null
  };
  return { ok: true, batch };
}

// 开始维护：冻结设备属性与相关链路（深拷贝当前拓扑作为快照）。
export function startBatch(input) {
  const snapshot = clone(input.topology);
  const batches = input.batches.map((b) =>
    b.id === input.batchId
      ? { ...b, status: BATCH_STATUS.ACTIVE, startedAt: new Date().toISOString(), snapshot }
      : b);
  const active = batches.find((b) => b.id === input.batchId);
  return { batches, activeId: input.batchId, snapshot, active };
}

// 结束前复核：通过则完成并释放冻结；失败则恢复快照、写明原因。
export function finishBatch(input) {
  const active = input.batches.find((b) => b.id === input.activeId);
  if (!active) return { ok: false, error: '没有进行中的批次' };

  const check = verifyReachability(active, input.topology);
  const finishedAt = new Date().toISOString();

  if (check.pass) {
    const batches = input.batches.map((b) =>
      b.id === active.id
        ? { ...b, status: BATCH_STATUS.COMPLETED, finishedAt, reason: null }
        : b);
    return {
      ok: true, pass: true, batches, activeId: null, snapshot: null,
      restoredTopology: null,
      message: `复核通过：批次 ${active.code} 的 ${active.deviceIds.length} 台设备均可到达核心路由器，维护完成`
    };
  }

  // 复核失败：恢复冻结前快照（原图），批次记录回退原因。
  const names = check.unreachable.map((u) => u.name || u.id).join('、');
  const reason =
    `结束前复核失败：${check.unreachable.length} 台设备无法到达核心路由器（${names}）；` +
    `已恢复批次 ${active.code} 开始前的冻结快照`;
  const batches = input.batches.map((b) =>
    b.id === active.id
      ? { ...b, status: BATCH_STATUS.ROLLED_BACK, finishedAt, reason }
      : b);
  return {
    ok: true, pass: false, batches, activeId: null, snapshot: null,
    restoredTopology: active.snapshot ? clone(active.snapshot) : null,
    message: reason
  };
}

export function cancelBatch(input) {
  const batches = input.batches.map((b) =>
    b.id === input.batchId
      ? { ...b, status: BATCH_STATUS.ROLLED_BACK, finishedAt: new Date().toISOString(),
          reason: `批次 ${b.code} 被手动取消，未开始维护` }
      : b);
  return { batches };
}

export function removeBatchRecord(input) {
  return { batches: input.batches.filter((b) => b.id !== input.batchId) };
}

// —— React 胶水：拓扑资料（topology）与批次资料（store + snapshot）分开持久化 ——

export function useMaintenance() {
  const [state, setState] = useState(() => {
    const stored = loadStore();
    const snapshot = loadSnapshot();
    // 活动批次始终带着它启动时的冻结快照，保证刷新后三者一致。
    const batches = stored.batches.map((b) =>
      b.id === stored.activeId && snapshot ? { ...b, snapshot } : b);
    return { batches, activeId: stored.activeId, snapshot };
  });

  useEffect(() => {
    persist(state.batches, state.activeId, state.snapshot);
  }, [state]);

  const active = state.batches.find((b) => b.id === state.activeId) || null;

  const api = {
    active,
    batches: state.batches,
    register: useCallback((draft, topology) => {
      const r = registerBatch({
        draft, topology,
        batches: state.batches, activeId: state.activeId
      });
      if (r.ok) setState((s) => ({ ...s, batches: [...s.batches, r.batch] }));
      return r;
    }, [state.batches, state.activeId]),

    start: useCallback((batchId, topology) => {
      setState((s) => {
        const r = startBatch({ batches: s.batches, batchId, topology });
        return { batches: r.batches, activeId: r.activeId, snapshot: r.snapshot };
      });
    }, []),

    finish: useCallback((topology) => {
      let outcome;
      setState((s) => {
        const withSnap = {
          batches: s.batches.map((b) =>
            b.id === s.activeId && s.snapshot ? { ...b, snapshot: s.snapshot } : b)
        };
        outcome = finishBatch({ batches: withSnap.batches, activeId: s.activeId, topology });
        if (!outcome.ok) return s;
        return { batches: outcome.batches, activeId: outcome.activeId, snapshot: null };
      });
      return outcome;
    }, []),

    cancel: useCallback((batchId) => {
      setState((s) => ({ ...s, ...cancelBatch({ batches: s.batches, batchId }) }));
    }, []),

    removeRecord: useCallback((batchId) => {
      setState((s) => ({
        ...s,
        ...removeBatchRecord({ batches: s.batches, batchId }),
        activeId: s.activeId === batchId ? null : s.activeId,
        snapshot: s.activeId === batchId ? null : s.snapshot
      }));
    }, [])
  };

  return api;
}
