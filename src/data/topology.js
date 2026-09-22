// 拓扑资料层：只负责初始拓扑数据与本地持久化，不含任何判定规则或界面逻辑。
export const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 220, ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 370, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 370, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 520, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 550, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 530, ip: '10.0.2.22' }
  ],
  edges: [['gw', 'sw1'], ['gw', 'sw2'], ['sw1', 'web'], ['sw1', 'db'], ['sw2', 'user']]
};

const TOPOLOGY_KEY = 'topology';

const validTopology = (t) =>
  t && Array.isArray(t.nodes) && Array.isArray(t.edges) &&
  t.nodes.every((n) => n && n.id && n.type);

export function loadTopology() {
  try {
    const t = JSON.parse(localStorage.getItem(TOPOLOGY_KEY));
    return validTopology(t) ? t : seed;
  } catch {
    return seed;
  }
}

export function saveTopology(topology) {
  localStorage.setItem(TOPOLOGY_KEY, JSON.stringify(topology));
}
