// 拓扑资料层：初始拓扑、资料存取、快照克隆。
// 本文件不包含任何维护规则，规则见 rules.js。

export const TOPOLOGY_KEY = 'topology';
export const BATCH_KEY = 'maintenance-batches';

export const DEVICE_TYPES = [
  ['router', '◉', '路由器'],
  ['switch', '▦', '交换机'],
  ['server', '▣', '服务器'],
  ['device', '▱', '终端设备'],
];

export const seed = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 220, ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 370, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 370, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 520, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 550, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 530, ip: '10.0.2.22' },
  ],
  edges: [
    ['gw', 'sw1'],
    ['gw', 'sw2'],
    ['sw1', 'web'],
    ['sw1', 'db'],
    ['sw2', 'user'],
  ],
};

// 维护期开始/回退核对使用的整图深拷贝（结构是简单 JSON，结构化克隆即可）。
export function cloneTopology(topo) {
  return {
    nodes: topo.nodes.map((n) => ({ ...n })),
    edges: topo.edges.map((e) => [e[0], e[1]]),
  };
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function loadTopology() {
  const t = read(TOPOLOGY_KEY, null);
  if (!t || !Array.isArray(t.nodes) || !Array.isArray(t.edges)) return cloneTopology(seed);
  return t;
}

export function saveTopology(topo) {
  localStorage.setItem(TOPOLOGY_KEY, JSON.stringify(topo));
}

export function loadBatches() {
  const list = read(BATCH_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveBatches(batches) {
  localStorage.setItem(BATCH_KEY, JSON.stringify(batches));
}
