// 画布：只读展示拓扑并承担拖动/连线交互；所有编辑都通过 props 回调，由 App 经规则层守卫。
import { TYPE_META, edgeKey, frozenEdgeSet } from '../rules/maintenance.js';

export default function TopologyCanvas({
  topology, selected, frozen, onSelect, onDragStart, onDragMove, onDragEnd, boardRef, activeCode
}) {
  const frozenEdges = frozenEdgeSet(frozen ? { snapshot: topology, deviceIds: frozen } : null);

  const move = (e) => {
    if (!onDragMove) return;
    const r = boardRef.current.getBoundingClientRect();
    onDragMove(e.clientX - r.left, e.clientY - r.top);
  };

  return (
    <div
      className="canvas"
      ref={boardRef}
      onMouseMove={move}
      onMouseUp={onDragEnd}
      onMouseLeave={onDragEnd}
    >
      {topology.edges.map(([a, b], i) => {
        const n1 = topology.nodes.find((n) => n.id === a);
        const n2 = topology.nodes.find((n) => n.id === b);
        if (!n1 || !n2) return null;
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const len = Math.hypot(dx, dy);
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        const isFrozen = frozen && frozenEdges.has(edgeKey(a, b));
        return (
          <div
            key={i}
            className={'edge' + (isFrozen ? ' frozen' : '')}
            style={{ left: n1.x, top: n1.y, width: len, transform: `rotate(${ang}deg)` }}
            title={isFrozen ? `维护冻结链路（批次 ${activeCode}）` : '链路'}
          >
            <span></span>
          </div>
        );
      })}

      {topology.nodes.map((n) => {
        const isFrozen = frozen && frozen.has(n.id);
        return (
          <button
            key={n.id}
            className={'node ' + n.type + (selected === n.id ? ' picked' : '') + (isFrozen ? ' frozen' : '')}
            style={{ left: n.x - 42, top: n.y - 31 }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onSelect(n.id);
              if (!isFrozen) onDragStart && onDragStart(n.id);
            }}
            onClick={() => onSelect(n.id)}
            title={isFrozen ? `维护冻结：${n.name}（批次 ${activeCode}）` : n.name}
          >
            {isFrozen && <i className="lock-badge">🔒</i>}
            <i>{TYPE_META[n.type]?.icon || '▱'}</i>
            <strong>{n.name}</strong>
            <small>{n.ip}</small>
          </button>
        );
      })}

      <div className="legend">
        <span><i className="router"></i>路由器</span>
        <span><i className="switch"></i>交换机</span>
        <span><i className="server"></i>服务器</span>
        {frozen && frozen.size > 0 && <span><i className="lock-swatch"></i>维护冻结</span>}
      </div>
    </div>
  );
}
