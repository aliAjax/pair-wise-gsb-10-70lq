// 持久化层：只负责回放状态与操作人的读写，不含回放规则与界面逻辑
const KEY = 'topology.replay.v1';
const OP_KEY = 'topology.replay.operator';
const LEGACY_KEY = 'topology';

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

// 读取回放状态（含上次停留的时间点）；首次运行时把旧版拓扑迁移为初始状态
export function loadReplay() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && saved.base && Array.isArray(saved.records)) {
      const cursor = Math.max(0, Math.min(typeof saved.cursor === 'number' ? saved.cursor : saved.records.length, saved.records.length));
      return { base: saved.base, records: saved.records, cursor };
    }
  } catch { /* 数据损坏时回退到初始状态 */ }
  let base = seed;
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
    if (legacy && Array.isArray(legacy.nodes) && Array.isArray(legacy.edges)) base = legacy;
  } catch { /* 无旧数据 */ }
  return { base, records: [], cursor: 0 };
}

export function saveReplay(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 存储不可用时忽略 */ }
}

export function loadOperator() {
  try { return localStorage.getItem(OP_KEY) || '未命名操作人'; } catch { return '未命名操作人'; }
}

export function saveOperator(op) {
  try { localStorage.setItem(OP_KEY, op); } catch { /* 忽略 */ }
}
