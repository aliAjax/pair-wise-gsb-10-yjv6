import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {
  DEVICE_TYPES,
  cloneTopology,
  loadBatches,
  loadTopology,
  saveBatches,
  saveTopology,
} from './topology.js';
import {
  STATUS,
  STATUS_LABEL,
  edgeChangeBlocked,
  edgeKey,
  getActiveBatch,
  isCoreRouter,
  lockedNodeIds,
  nodeEditBlocked,
  nodeRemovalBlocked,
  reachabilityCheck,
  validateRegistration,
} from './rules.js';

const typeIcon = (t) =>
  t === 'router' ? '◉' : t === 'switch' ? '▦' : t === 'server' ? '▣' : '▱';

// 本地时间 → datetime-local 控件值（yyyy-MM-ddTHH:mm）。
function toLocalInput(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function defaultWindow() {
  const start = new Date(Math.ceil(Date.now() / 300000) * 300000);
  const end = new Date(start.getTime() + 2 * 3600000);
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

const fmtWindow = (b) =>
  `${new Date(b.start).toLocaleString('zh-CN', { hour12: false })} ～ ${new Date(
    b.end,
  ).toLocaleString('zh-CN', { hour12: false })}`;

const emptyForm = () => ({
  name: '',
  owner: '',
  ...defaultWindow(),
  deviceIds: [],
  backups: [{ a: '', b: '' }],
});

function App() {
  const [data, setData] = useState(loadTopology);
  const [batches, setBatches] = useState(loadBatches);
  const [selected, setSelected] = useState(data.nodes[0]?.id || '');
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState('');
  const [drag, setDrag] = useState(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const board = useRef();
  const toastTimer = useRef();

  const activeBatch = useMemo(() => getActiveBatch(batches), [batches]);
  const locked = useMemo(() => lockedNodeIds(activeBatch), [activeBatch]);

  // 刷新后批次、锁定与快照由 localStorage 恢复，三者来自同一份持久化资料。
  useEffect(() => saveTopology(data), [data]);
  useEffect(() => saveBatches(batches), [batches]);
  useEffect(() => {
    if (!notice) return undefined;
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(toastTimer.current);
  }, [notice]);

  const node = data.nodes.find((n) => n.id === selected) || data.nodes[0];

  // —— 拓扑操作，全部经过冻结规则把关 ——

  const updateNode = (k, v) => {
    const reason = nodeEditBlocked(node.id, activeBatch);
    if (reason) return setNotice(reason);
    setData({
      ...data,
      nodes: data.nodes.map((n) => (n.id === node.id ? { ...n, [k]: v } : n)),
    });
  };

  const addNode = (type, label) => {
    const id = `node${Date.now()}`;
    const n = {
      id,
      name: label || '新设备',
      type: type || 'device',
      x: 470 + Math.round(Math.random() * 60),
      y: 300 + Math.round(Math.random() * 40),
      ip: '192.168.0.10',
    };
    setData({ ...data, nodes: [...data.nodes, n] });
    setSelected(id);
    setTool('select');
    setNotice('已添加设备');
  };

  const guardConnect = (a, b) => {
    if (!a || !b || a === b) return;
    if (!data.nodes.some((n) => n.id === b)) {
      setNotice(`设备 ${b} 不存在`);
      return;
    }
    if (
      data.edges.some(
        (e) =>
          (e[0] === a && e[1] === b) || (e[1] === a && e[0] === b),
      )
    ) {
      setNotice('两台设备之间已存在连接');
      return;
    }
    const reason = edgeChangeBlocked(a, b, activeBatch);
    if (reason) {
      setNotice(reason);
      return;
    }
    setData({ ...data, edges: [...data.edges, [a, b]] });
    setNotice('连接已创建');
  };

  const connect = () => {
    if (!node) return;
    // eslint-disable-next-line no-alert
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (other) guardConnect(node.id, other.trim());
  };

  const removeEdge = (a, b) => {
    const reason = edgeChangeBlocked(a, b, activeBatch);
    if (reason) return setNotice(reason);
    setData({
      ...data,
      edges: data.edges.filter(([x, y]) => edgeKey(x, y) !== edgeKey(a, b)),
    });
    setNotice('连接已删除');
  };

  const remove = () => {
    if (!node) return;
    const reason = nodeRemovalBlocked(node.id, data, activeBatch);
    if (reason) return setNotice(reason);
    setData({
      ...data,
      nodes: data.nodes.filter((n) => n.id !== node.id),
      edges: data.edges.filter((e) => !e.includes(node.id)),
    });
    setSelected(data.nodes.find((n) => n.id !== node.id)?.id || '');
    setNotice('设备已删除');
  };

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    a.download = 'network-topology.json';
    a.click();
    setNotice('JSON 已导出');
  };

  const validate = () => {
    const linked = new Set(data.edges.flat());
    const isolated = data.nodes.filter((n) => !linked.has(n.id));
    setNotice(
      isolated.length
        ? `发现 ${isolated.length} 个孤立节点`
        : '拓扑检查通过：没有孤立节点',
    );
  };

  const move = (e) => {
    if (!drag) return;
    const r = board.current.getBoundingClientRect();
    setData({
      ...data,
      nodes: data.nodes.map((n) =>
        n.id === drag
          ? {
              ...n,
              x: Math.max(35, e.clientX - r.left),
              y: Math.max(35, e.clientY - r.top),
            }
          : n,
      ),
    });
  };

  const beginDrag = (id) => {
    setSelected(id);
    const reason = nodeEditBlocked(id, activeBatch);
    if (reason) {
      setNotice(reason);
      return;
    }
    setDrag(id);
  };

  // —— 批次生命周期 ——

  // 登记：规则不通过则整批拒绝，不写入批次、不触碰原图。
  const registerBatch = (form) => {
    const result = validateRegistration(form, data, batches);
    if (!result.ok) {
      setNotice(`批次已整批拒绝：${result.reasons.join('；')}（原图未改动）`);
      return false;
    }
    setBatches([...batches, result.batch]);
    setNotice(`批次「${result.batch.name}」登记成功`);
    return true;
  };

  // 开始维护：冻结设备属性与相关链路，并保存冻结前整图快照。
  const startBatch = (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    if (activeBatch) {
      setNotice(`批次「${activeBatch.name}」仍在维护中，请先结束或回退`);
      return;
    }
    setBatches(
      batches.map((b) =>
        b.id === id
          ? {
              ...b,
              status: STATUS.ACTIVE,
              startedAt: new Date().toISOString(),
              snapshot: cloneTopology(data),
            }
          : b,
      ),
    );
    setNotice(
      `批次「${batch.name}」开始维护：已冻结 ${batch.deviceIds.length} 台设备及其相关链路`,
    );
  };

  // 结束维护：先复核设备可达核心路由器；失败则恢复冻结快照并写明原因。
  const finishBatch = (id) => {
    const batch = batches.find((b) => b.id === id);
    if (!batch) return;
    const check = reachabilityCheck(data, batch.deviceIds);
    const finishedAt = new Date().toISOString();
    if (!check.ok) {
      if (batch.snapshot) setData(cloneTopology(batch.snapshot));
      if (!selected || !batch.snapshot?.nodes.some((n) => n.id === selected)) {
        setSelected(batch.snapshot?.nodes[0]?.id || '');
      }
      setBatches(
        batches.map((b) =>
          b.id === id
            ? {
                ...b,
                status: STATUS.ROLLED_BACK,
                finishedAt,
                failReason: check.reason,
              }
            : b,
        ),
      );
      setNotice(check.reason);
      return;
    }
    setBatches(
      batches.map((b) =>
        b.id === id
          ? { ...b, status: STATUS.DONE, finishedAt, failReason: null }
          : b,
      ),
    );
    setNotice(`复核通过：批次「${batch.name}」全部设备可达核心路由器，维护完成`);
  };

  const cancelBatch = (id) => {
    setBatches(batches.filter((b) => b.id !== id));
    setNotice('待开始批次已撤销');
  };

  const selectedLocked = node ? locked.has(node.id) : false;
  const removalReason = node ? nodeRemovalBlocked(node.id, data, activeBatch) : null;
  const frozenEdge = (a, b) => locked.has(a) || locked.has(b);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div>
            <strong>NETSCAPE</strong>
            <small>MAINTENANCE CONTROL</small>
          </div>
        </div>
        <div className="file">
          <span className={`dot ${activeBatch ? 'dot-busy' : ''}`}></span>
          <div>
            <strong>office-network.json</strong>
            <small>
              {activeBatch
                ? `维护中：${activeBatch.name}`
                : '无进行中的维护批次'}
            </small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={validate}>✓ 检查</button>
          <button onClick={exportJson}>↓ 导出</button>
          <button
            className={consoleOpen ? 'save on' : 'save'}
            onClick={() => setConsoleOpen(!consoleOpen)}
          >
            🛠 维护批次台
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button
            className={tool === 'select' ? 'on' : ''}
            onClick={() => setTool('select')}
          >
            ↖ 选择
          </button>
          <button onClick={connect}>⌁ 连接</button>
          <button onClick={() => addNode('device', '新设备')}>＋ 设备</button>
        </div>
        <div className="tool-group zoom">
          <button
            onClick={() =>
              setNotice(
                activeBatch
                  ? `冻结设备 ${locked.size} 台 · 冻结链路 ${
                      data.edges.filter(([a, b]) => frozenEdge(a, b)).length
                    } 条`
                  : '当前没有维护冻结',
              )
            }
          >
            🔒
          </button>
          <span>{activeBatch ? `${locked.size} 台冻结` : '100%'}</span>
        </div>
      </div>

      {activeBatch && (
        <div className="freeze-banner">
          <b>维护冻结中</b>
          <span>
            批次「{activeBatch.name}」 · 责任人 {activeBatch.owner} · 设备{' '}
            {activeBatch.deviceIds.join('、')} — 这些设备的属性与相关链路已冻结，禁止改属性或移除设备
          </span>
        </div>
      )}

      <div className={`workspace ${consoleOpen ? 'with-console' : ''}`}>
        <aside className="inventory">
          <div className="section-title">
            <span>设备库</span>
            <small>{data.nodes.length} 个节点</small>
          </div>
          <div className="device-types">
            {DEVICE_TYPES.map(([t, i, l]) => (
              <button key={t} onClick={() => addNode(t, l)}>
                <i className={t}>{i}</i>
                {l}
                <span>＋</span>
              </button>
            ))}
          </div>
          <div className="section-title nodes-head">
            <span>图中节点</span>
            <small>点击查看</small>
          </div>
          <div className="node-list">
            {data.nodes.map((n) => (
              <button
                key={n.id}
                className={selected === n.id ? 'sel' : ''}
                onClick={() => setSelected(n.id)}
              >
                <i className={n.type}>{typeIcon(n.type)}</i>
                <span>
                  <strong>{n.name}</strong>
                  <small>{n.ip}</small>
                </span>
                {locked.has(n.id) ? <b className="lock-tag">🔒</b> : <b>›</b>}
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-wrap">
          <div
            className="canvas"
            ref={board}
            onMouseMove={move}
            onMouseUp={() => setDrag(null)}
            onMouseLeave={() => setDrag(null)}
          >
            {data.edges.map(([a, b], i) => {
              const n1 = data.nodes.find((n) => n.id === a);
              const n2 = data.nodes.find((n) => n.id === b);
              if (!n1 || !n2) return null;
              const dx = n2.x - n1.x;
              const dy = n2.y - n1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <div
                  key={i}
                  className={`edge ${frozenEdge(a, b) ? 'edge-frozen' : ''}`}
                  style={{
                    left: n1.x,
                    top: n1.y,
                    width: len,
                    transform: `rotate(${ang}deg)`,
                  }}
                >
                  <span></span>
                </div>
              );
            })}
            {data.nodes.map((n) => (
              <button
                key={n.id}
                className={
                  'node '
                  + n.type
                  + (selected === n.id ? ' picked' : '')
                  + (locked.has(n.id) ? ' node-frozen' : '')
                }
                style={{ left: n.x - 42, top: n.y - 31 }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  beginDrag(n.id);
                }}
                onClick={() => setSelected(n.id)}
              >
                {locked.has(n.id) && <em className="lock-badge">🔒</em>}
                <i>{typeIcon(n.type)}</i>
                <strong>{n.name}</strong>
                <small>{n.ip}</small>
              </button>
            ))}
            <div className="legend">
              <span><i className="router"></i>路由器</span>
              <span><i className="switch"></i>交换机</span>
              <span><i className="server"></i>服务器</span>
              {activeBatch && <span><i className="legend-lock"></i>冻结</span>}
            </div>
          </div>
          <div className="canvas-footer">
            <span>
              拖动节点调整位置 · {data.edges.length} 条连接
              {activeBatch &&
                ` · 冻结链路 ${data.edges.filter(([a, b]) => frozenEdge(a, b)).length} 条`}
            </span>
            <span>坐标系：画布局部</span>
          </div>
        </section>

        <aside className="inspector">
          <div className="section-title">
            <span>属性</span>
            <small>{node?.type}</small>
          </div>
          {node ? (
            <>
              {removalReason && <div className="lock-banner">🔒 {removalReason}</div>}
              <label>
                设备名称
                <input
                  value={node.name}
                  readOnly={selectedLocked}
                  onChange={(e) => updateNode('name', e.target.value)}
                />
              </label>
              <label>
                IP 地址
                <input
                  value={node.ip}
                  readOnly={selectedLocked}
                  onChange={(e) => updateNode('ip', e.target.value)}
                />
              </label>
              <label>
                设备类型
                <select
                  value={node.type}
                  disabled={selectedLocked}
                  onChange={(e) => updateNode('type', e.target.value)}
                >
                  {DEVICE_TYPES.map(([t, , l]) => (
                    <option key={t} value={t}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="readonly-id">
                设备 ID
                <input value={node.id} readOnly />
              </label>
              <div className="inspector-actions">
                <button onClick={connect}>⌁ 添加连接</button>
                <button
                  className="danger"
                  onClick={remove}
                  disabled={!!removalReason}
                >
                  {removalReason ? '🔒 禁止移除' : '删除设备'}
                </button>
              </div>
              <div className="connections">
                <div className="section-title">
                  <span>连接</span>
                  <small>
                    {data.edges.filter((e) => e.includes(node.id)).length} 条
                  </small>
                </div>
                {data.edges
                  .filter((e) => e.includes(node.id))
                  .map((e) => {
                    const other = data.nodes.find(
                      (n) => n.id === (e[0] === node.id ? e[1] : e[0]),
                    );
                    const isFrozen = frozenEdge(e[0], e[1]);
                    return (
                      <div className="connection" key={edgeKey(e[0], e[1])}>
                        <span className={`mini ${other?.type}`}></span>
                        <strong>{other ? other.name : e[0] === node.id ? e[1] : e[0]}</strong>
                        <small>{isFrozen ? '冻结' : '在线'}</small>
                        <button
                          className={`edge-del${isFrozen ? ' edge-del-frozen' : ''}`}
                          title={isFrozen ? '冻结链路不可移除' : '移除连接'}
                          disabled={isFrozen}
                          onClick={() => removeEdge(e[0], e[1])}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
              </div>
            </>
          ) : (
            <p>选择一个设备</p>
          )}
        </aside>

        {consoleOpen && (
          <MaintenanceConsole
            topo={data}
            batches={batches}
            activeBatch={activeBatch}
            onClose={() => setConsoleOpen(false)}
            onRegister={registerBatch}
            onStart={startBatch}
            onFinish={finishBatch}
            onCancel={cancelBatch}
          />
        )}
      </div>

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function MaintenanceConsole({
  topo,
  batches,
  activeBatch,
  onClose,
  onRegister,
  onStart,
  onFinish,
  onCancel,
}) {
  const [form, setForm] = useState(emptyForm);
  const [touched, setTouched] = useState(false);

  const set = (k, v) => {
    setTouched(true);
    setForm((f) => ({ ...f, [k]: v }));
  };
  const toggleDevice = (id) => {
    setTouched(true);
    setForm((f) => ({
      ...f,
      deviceIds: f.deviceIds.includes(id)
        ? f.deviceIds.filter((d) => d !== id)
        : [...f.deviceIds, id],
    }));
  };
  const setBackup = (i, k, v) => {
    setTouched(true);
    setForm((f) => ({
      ...f,
      backups: f.backups.map((l, j) => (j === i ? { ...l, [k]: v } : l)),
    }));
  };

  // 预校验仍走 rules.js，表单内展示拒绝原因；提交时再完整校验一次。
  const preview = useMemo(
    () => validateRegistration(form, topo, batches),
    [form, topo, batches],
  );
  const previewReasons = touched && !preview.ok ? preview.reasons : [];
  const selectedInvolvesCore = topo.nodes.some(
    (n) => form.deviceIds.includes(n.id) && isCoreRouter(n),
  );

  const submit = () => {
    const result = validateRegistration(form, topo, batches);
    if (!result.ok) {
      setTouched(true);
      onRegister(form); // 通知层统一提示“整批拒绝、原图未改动”
      return;
    }
    setTouched(false);
    if (onRegister(form)) setForm(emptyForm());
  };

  return (
    <aside className="console">
      <div className="console-head">
        <div>
          <strong>设备维护批次与回退核对台</strong>
          <small>
            {activeBatch
              ? `进行中：${activeBatch.name}`
              : '登记设备、时段、责任人与备用链路'}
          </small>
        </div>
        <button className="console-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="console-body">
        <section className="batch-form">
          <div className="console-section-title">登记新批次</div>
          <label>
            批次名称
            <input
              value={form.name}
              placeholder="例如 核心机房春季维护"
              onChange={(e) => set('name', e.target.value)}
            />
          </label>
          <label>
            责任人
            <input
              value={form.owner}
              placeholder="工号或姓名"
              onChange={(e) => set('owner', e.target.value)}
            />
          </label>
          <div className="form-row">
            <label>
              开始时间
              <input
                type="datetime-local"
                value={form.start}
                onChange={(e) => set('start', e.target.value)}
              />
            </label>
            <label>
              结束时间
              <input
                type="datetime-local"
                value={form.end}
                onChange={(e) => set('end', e.target.value)}
              />
            </label>
          </div>

          <div className="console-section-title">
            登记设备
            <small>
              {form.deviceIds.length} 台
              {selectedInvolvesCore ? ' · 含核心路由器' : ''}
            </small>
          </div>
          <div className="device-picker">
            {topo.nodes.map((n) => (
              <button
                key={n.id}
                className={form.deviceIds.includes(n.id) ? 'picked' : ''}
                onClick={() => toggleDevice(n.id)}
              >
                <i className={n.type}>{typeIcon(n.type)}</i>
                <span>
                  <strong>
                    {n.name}
                    {isCoreRouter(n) && <em className="core-tag">核心</em>}
                  </strong>
                  <small>{n.id}</small>
                </span>
                <b>{form.deviceIds.includes(n.id) ? '✓' : '+'}</b>
              </button>
            ))}
          </div>

          <div className="console-section-title">
            备用链路
            <small>涉及核心路由器时必填</small>
          </div>
          <div className="backup-list">
            {form.backups.map((l, i) => (
              <div className="backup-row" key={i}>
                <select
                  value={l.a}
                  onChange={(e) => setBackup(i, 'a', e.target.value)}
                >
                  <option value="">选择设备</option>
                  {topo.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}（{n.id}）
                    </option>
                  ))}
                </select>
                <span>⌁</span>
                <select
                  value={l.b}
                  onChange={(e) => setBackup(i, 'b', e.target.value)}
                >
                  <option value="">选择设备</option>
                  {topo.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}（{n.id}）
                    </option>
                  ))}
                </select>
                <button
                  className="edge-del"
                  onClick={() => {
                    setTouched(true);
                    setForm((f) => ({
                      ...f,
                      backups: f.backups.filter((_, j) => j !== i),
                    }));
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="add-backup"
              onClick={() => {
                setTouched(true);
                setForm((f) => ({ ...f, backups: [...f.backups, { a: '', b: '' }] }));
              }}
            >
              ＋ 添加备用链路
            </button>
          </div>

          {previewReasons.length > 0 && (
            <ul className="rule-errors">
              {previewReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}

          <button
            className="register-btn"
            disabled={!!activeBatch || previewReasons.length > 0}
            onClick={submit}
          >
            {activeBatch ? '有批次维护中，暂不能登记' : '登记批次'}
          </button>
        </section>

        <section className="batch-list">
          <div className="console-section-title">
            批次记录
            <small>{batches.length} 条</small>
          </div>
          {batches.length === 0 && <p className="empty-hint">暂无批次</p>}
          {batches
            .slice()
            .reverse()
            .map((b) => (
              <BatchCard
                key={b.id}
                batch={b}
                topo={topo}
                active={activeBatch?.id === b.id}
                onStart={onStart}
                onFinish={onFinish}
                onCancel={onCancel}
              />
            ))}
        </section>
      </div>
    </aside>
  );
}

function BatchCard({ batch, topo, active, onStart, onFinish, onCancel }) {
  const nameOf = (id) => topo.nodes.find((n) => n.id === id)?.name || id;
  return (
    <div className={`batch-card status-${batch.status}`}>
      <div className="batch-card-head">
        <strong>{batch.name}</strong>
        <span className={`status-pill status-${batch.status}`}>
          {STATUS_LABEL[batch.status]}
        </span>
      </div>
      <div className="batch-meta">
        <span>👤 {batch.owner}</span>
        <span>🕓 {fmtWindow(batch)}</span>
      </div>
      <div className="batch-devices">
        {batch.deviceIds.map((id) => (
          <span key={id} className="batch-chip">
            {nameOf(id)}
            {isCoreRouter(topo.nodes.find((n) => n.id === id)) && ' ★'}
          </span>
        ))}
      </div>
      {batch.backups.length > 0 && (
        <div className="batch-backups">
          备用：
          {batch.backups
            .map(([a, b]) => `${nameOf(a)} ⌁ ${nameOf(b)}`)
            .join('；')}
        </div>
      )}
      {batch.snapshot && (
        <div className="batch-snapshot">
          冻结快照：{batch.snapshot.nodes.length} 台设备 / {batch.snapshot.edges.length}{' '}
          条链路（{new Date(batch.startedAt).toLocaleString('zh-CN', { hour12: false })}）
        </div>
      )}
      {batch.status === STATUS.ROLLED_BACK && batch.failReason && (
        <div className="rollback-reason">⚠ {batch.failReason}</div>
      )}
      {batch.status === STATUS.DONE && (
        <div className="done-note">
          ✓ 结束前复核通过，已于{' '}
          {new Date(batch.finishedAt).toLocaleString('zh-CN', { hour12: false })}完成
        </div>
      )}
      <div className="batch-actions">
        {batch.status === STATUS.REGISTERED && (
          <>
            <button
              className="primary"
              disabled={!!active}
              onClick={() => onStart(batch.id)}
            >
              开始维护（冻结）
            </button>
            <button onClick={() => onCancel(batch.id)}>撤销登记</button>
          </>
        )}
        {batch.status === STATUS.ACTIVE && (
          <button className="primary" onClick={() => onFinish(batch.id)}>
            结束并复核可达核心
          </button>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
