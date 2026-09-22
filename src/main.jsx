// 应用装配层：组合拓扑资料、批次状态与各界面组件；编辑动作一律先走判定层守卫。
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { loadTopology, saveTopology } from './data/topology.js';
import { useMaintenance } from './state/maintenanceStore.js';
import {
  edgeKey, guardNodeEdit, guardNodeRemove, guardEdgeChange,
  lockedNodeIds, frozenEdgeSet
} from './rules/maintenance.js';
import Inventory from './ui/Inventory.jsx';
import TopologyCanvas from './ui/TopologyCanvas.jsx';
import Inspector from './ui/Inspector.jsx';
import BatchConsole from './ui/BatchConsole.jsx';

function App() {
  const [data, setData] = useState(loadTopology);
  const [selected, setSelected] = useState(() =>
    loadTopology().nodes[0]?.id ?? null);
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const board = useRef();

  const maintenance = useMaintenance();
  const { active, batches } = maintenance;
  const frozen = lockedNodeIds(active);
  const frozenEdges = frozenEdgeSet(active);

  useEffect(() => saveTopology(data), [data]);

  const toast = (msg) => setNotice(msg);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 3800);
    return () => clearTimeout(t);
  }, [notice]);

  const node = data.nodes.find((n) => n.id === selected) || data.nodes[0] || null;

  // —— 受守卫的拓扑编辑 ——
  const updateNode = (k, v) => {
    const denied = guardNodeEdit(active, selected);
    if (denied) return toast(denied);
    setData((d) => ({
      ...d,
      nodes: d.nodes.map((n) => (n.id === selected ? { ...n, [k]: v } : n))
    }));
  };

  const addNode = (type = 'device', label) => {
    const id = 'node' + Date.now();
    const n = { id, name: label || '新设备', type, x: 500, y: 300, ip: '192.168.0.10' };
    setData((d) => ({ ...d, nodes: [...d.nodes, n] }));
    setSelected(id);
    setTool('select');
    toast('已添加设备');
  };

  const connect = () => {
    if (!selected) return;
    if (active && frozen.has(selected)) {
      return toast(guardNodeEdit(active, selected));
    }
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (!other) return;
    if (!data.nodes.some((n) => n.id === other)) return toast('目标设备不存在');
    if (other === selected) return toast('不能连接设备自身');
    if (data.edges.some((e) => edgeKey(e[0], e[1]) === edgeKey(selected, other))) {
      return toast('连接已存在');
    }
    // 冻结链路相关：任一端被冻结都不能新增链路。
    const endLocked = active && frozen.has(other);
    if (endLocked) return toast(`对端 ${other} 处于维护冻结中，不能新增链路`);
    setData((d) => ({ ...d, edges: [...d.edges, [selected, other]] }));
    toast('连接已创建');
  };

  const removeEdge = (a, b) => {
    const denied = guardEdgeChange(active, a, b);
    if (denied) return toast(denied);
    setData((d) => ({
      ...d,
      edges: d.edges.filter((e) => edgeKey(e[0], e[1]) !== edgeKey(a, b))
    }));
    toast('链路已移除');
  };

  const remove = () => {
    if (!selected) return;
    const denied = guardNodeRemove(active, data, selected);
    if (denied) return toast(denied);
    setData((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== selected),
      edges: d.edges.filter((e) => !e.includes(selected))
    }));
    setSelected(data.nodes.find((n) => n.id !== selected)?.id ?? null);
    toast('设备已删除');
  };

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'network-topology.json';
    a.click();
    toast('JSON 已导出');
  };

  const validate = () => {
    const linked = new Set(data.edges.flat());
    const isolated = data.nodes.filter((n) => !linked.has(n.id));
    toast(isolated.length ? `发现 ${isolated.length} 个孤立节点` : '拓扑检查通过：没有孤立节点');
  };

  // —— 画布拖动：冻结节点不可拖动 ——
  const startDrag = (id) => setDrag(id);
  const moveDrag = (x, y) => {
    if (!drag || (active && frozen.has(drag))) return;
    setData((d) => ({
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === drag ? { ...n, x: Math.max(35, x), y: Math.max(35, y) } : n)
    }));
  };

  // —— 批次动作 ——
  const handleRegister = (draft) => {
    const r = maintenance.register(draft, data);
    if (r.ok) toast(`批次 ${r.batch.code} 已登记`);
    return r;
  };
  const handleStart = (batchId) => {
    maintenance.start(batchId, data);
    const b = batches.find((x) => x.id === batchId);
    toast(`批次 ${b?.code || ''} 开始维护：设备属性与相关链路已冻结`);
  };
  const handleFinish = () => {
    const r = maintenance.finish(data);
    if (!r?.ok) return toast(r?.error || '无法结束批次');
    if (r.restoredTopology) {
      setData(r.restoredTopology); // 复核失败：恢复冻结快照（原图）
      setSelected((sel) => r.restoredTopology.nodes.some((n) => n.id === sel)
        ? sel : r.restoredTopology.nodes[0]?.id ?? null);
    }
    toast(r.message);
  };

  const registeredCount = batches.filter((b) => b.status === 'registered').length;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div><strong>NETSCAPE</strong><small>MAINTENANCE BATCH CONSOLE</small></div>
        </div>
        <div className="file">
          <span className={'dot' + (active ? ' active-main' : '')}></span>
          <div>
            <strong>{active ? `维护中 · ${active.code}` : 'office-network.json'}</strong>
            <small>{active ? `${frozen.size} 台设备冻结 · 责任人 ${active.owner}` : '最近保存：自动持久化'}</small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={validate}>✓ 检查</button>
          <button onClick={exportJson}>↓ 导出</button>
          <button className={'batch-btn' + (consoleOpen ? ' on' : '')} onClick={() => setConsoleOpen(true)}>
            🛠 维护批次{registeredCount + (active ? 1 : 0) > 0 ? ` (${registeredCount + (active ? 1 : 0)})` : ''}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')}>↖ 选择</button>
          <button onClick={() => { setTool('connect'); connect(); }}>⌁ 连接</button>
          <button onClick={() => addNode()}>＋ 设备</button>
        </div>
        <div className="tool-group zoom">
          <button title="占位">−</button><span>100%</span><button title="占位">＋</button>
          <button onClick={() => toast('画布已居中')}>⌗</button>
        </div>
      </div>

      {active && (
        <div className="maint-banner">
          <span>🔒 批次 {active.code}「{active.name}」维护中：已冻结 {frozen.size} 台设备及其
            {' '}{data.edges.filter(([a, b]) => frozen.has(a) || frozen.has(b)).length} 条相关链路，
            禁止修改属性或移除设备。备用链路：
            {active.backupLink
              ? `${active.backupLink[0]} ⌁ ${active.backupLink[1]}`
              : '无（本批不涉及核心路由器）'}
          </span>
          <button onClick={() => setConsoleOpen(true)}>结束前复核 →</button>
        </div>
      )}

      <div className={'workspace' + (active ? ' with-banner' : '')}>
        <Inventory
          topology={data} selected={selected} frozen={frozen}
          onSelect={setSelected}
          onQuickAdd={(t) => addNode(t, { router: '路由器', switch: '交换机', server: '服务器', device: '终端设备' }[t])}
        />
        <section className="canvas-wrap">
          <TopologyCanvas
            topology={data} selected={selected} frozen={frozen}
            activeCode={active?.code}
            boardRef={board}
            onSelect={setSelected}
            onDragStart={startDrag} onDragMove={moveDrag}
            onDragEnd={() => setDrag(null)}
          />
          <div className="canvas-footer">
            <span>拖动节点调整位置 · {data.edges.length} 条连接{frozen.size > 0 ? ` · ${frozenEdges.size} 条链路冻结` : ''}</span>
            <span>坐标系：画布局部</span>
          </div>
        </section>
        <Inspector
          node={node} topology={data} frozenEdges={frozenEdges}
          frozenReason={active && frozen.has(node?.id) ? guardNodeEdit(active, node.id) : null}
          onUpdate={updateNode} onConnect={connect} onRemove={remove} onRemoveEdge={removeEdge}
        />
      </div>

      <BatchConsole
        open={consoleOpen} onClose={() => setConsoleOpen(false)}
        topology={data} batches={batches} active={active}
        onRegister={handleRegister} onStart={handleStart}
        onFinish={handleFinish}
        onCancel={(id) => { maintenance.cancel(id); toast('批次已取消'); }}
        onRemove={(id) => { maintenance.removeRecord(id); toast('批次记录已删除'); }}
      />

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
