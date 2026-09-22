// 右侧属性检查器：维护冻结期间禁用全部属性输入、删除及对冻结链路的移除。
import { TYPE_META, edgeKey } from '../rules/maintenance.js';

export default function Inspector({
  node, topology, frozenEdges, frozenReason,
  onUpdate, onConnect, onRemove, onRemoveEdge
}) {
  if (!node) {
    return (
      <aside className="inspector">
        <div className="section-title"><span>属性</span></div>
        <p className="hint">选择一个设备</p>
      </aside>
    );
  }

  const locked = !!frozenReason;
  const incident = topology.edges
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.includes(node.id));

  return (
    <aside className="inspector">
      <div className="section-title">
        <span>属性{locked ? ' 🔒' : ''}</span>
        <small>{TYPE_META[node.type]?.label}</small>
      </div>

      {locked && <div className="freeze-note">{frozenReason}</div>}

      <fieldset className="prop-form" disabled={locked}>
        <label>设备名称
          <input value={node.name} onChange={(e) => onUpdate('name', e.target.value)} />
        </label>
        <label>IP 地址
          <input value={node.ip} onChange={(e) => onUpdate('ip', e.target.value)} />
        </label>
        <label>设备类型
          <select value={node.type} onChange={(e) => onUpdate('type', e.target.value)}>
            {Object.entries(TYPE_META).map(([t, meta]) => (
              <option key={t} value={t}>{meta.label}</option>
            ))}
          </select>
        </label>
        <div className="inspector-actions">
          <button type="button" onClick={onConnect}>⌁ 添加连接</button>
          <button type="button" className="danger" onClick={onRemove}>删除设备</button>
        </div>
      </fieldset>

      <div className="connections">
        <div className="section-title">
          <span>连接</span>
          <small>{incident.length} 条</small>
        </div>
        {incident.map(({ e, i }) => {
          const otherId = e[0] === node.id ? e[1] : e[0];
          const other = topology.nodes.find((n) => n.id === otherId);
          const isFrozen = frozenEdges.has(edgeKey(e[0], e[1]));
          return (
            <div className={'connection' + (isFrozen ? ' frozen' : '')} key={i}>
              <span className={'mini ' + (other?.type || 'device')}></span>
              <strong>{other?.name || otherId}</strong>
              {isFrozen
                ? <small className="locked-tag">🔒 冻结</small>
                : <>
                    <small>在线</small>
                    <button className="edge-del" title="移除链路"
                      onClick={() => onRemoveEdge(e[0], e[1])}>×</button>
                  </>}
            </div>
          );
        })}
        {incident.length === 0 && <p className="hint">暂无连接</p>}
      </div>
    </aside>
  );
}
