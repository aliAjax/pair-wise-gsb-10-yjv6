// 左侧设备库与图中节点列表。
import { TYPE_META } from '../rules/maintenance.js';

export default function Inventory({ topology, selected, frozen, onSelect, onQuickAdd }) {
  return (
    <aside className="inventory">
      <div className="section-title">
        <span>设备库</span>
        <small>{topology.nodes.length} 个节点</small>
      </div>
      <div className="device-types">
        {Object.entries(TYPE_META).map(([t, meta]) => (
          <button key={t} onClick={() => onQuickAdd(t)}>
            <i className={t}>{meta.icon}</i>{meta.label}<span>＋</span>
          </button>
        ))}
      </div>
      <div className="section-title nodes-head">
        <span>图中节点</span>
        <small>点击查看</small>
      </div>
      <div className="node-list">
        {topology.nodes.map((n) => (
          <button key={n.id} className={selected === n.id ? 'sel' : ''} onClick={() => onSelect(n.id)}>
            <i className={n.type}>{TYPE_META[n.type]?.icon || '▱'}</i>
            <span>
              <strong>{n.name}{frozen && frozen.has(n.id) ? ' 🔒' : ''}</strong>
              <small>{n.ip}</small>
            </span>
            <b>›</b>
          </button>
        ))}
      </div>
    </aside>
  );
}
