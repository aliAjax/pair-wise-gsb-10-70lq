// 保存层 —— 只管 localStorage 读写
// 回放规则（engine.js）与界面（main.jsx）都不直接碰存储。
import { cloneGraph, nextSeq, emptyGraph } from './engine';

const KEY = 'topology-history-v1';

// 最初内置的一张图，作为重放基线
export const seedGraph = {
  nodes: [
    { id: 'gw', name: '核心路由器', type: 'router', x: 470, y: 220, ip: '10.0.0.1' },
    { id: 'sw1', name: '交换机 A', type: 'switch', x: 250, y: 370, ip: '10.0.1.1' },
    { id: 'sw2', name: '交换机 B', type: 'switch', x: 690, y: 370, ip: '10.0.2.1' },
    { id: 'web', name: 'Web Server', type: 'server', x: 100, y: 520, ip: '10.0.1.10' },
    { id: 'db', name: 'Database', type: 'server', x: 400, y: 550, ip: '10.0.1.20' },
    { id: 'user', name: '办公终端', type: 'device', x: 820, y: 530, ip: '10.0.2.22' },
  ],
  edges: [
    ['gw', 'sw1'], ['gw', 'sw2'], ['sw1', 'web'], ['sw1', 'db'], ['sw2', 'user'],
  ],
};

export function defaultState() {
  return {
    base: cloneGraph(seedGraph),
    records: [],
    seq: 0,
    marker: null, // null = 现在；重开时从这里恢复上次看到的时间点
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.records) || !s.base) return defaultState();
    return {
      base: { nodes: s.base.nodes || [], edges: s.base.edges || [] },
      records: s.records,
      seq: s.seq ?? nextSeq(s.records),
      marker: s.marker === undefined ? null : s.marker,
    };
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// 构造一条新记录（时间、操作人、提交顺序在此刻确定）
let rid = 0;
export function makeRecord(type, payload, author, records, time = Date.now()) {
  return {
    id: 'r' + Date.now().toString(36) + (rid++).toString(36),
    type,
    payload,
    time,
    seq: nextSeq(records),
    author: author || '当前用户',
    revoked: false,
  };
}

export { emptyGraph };
