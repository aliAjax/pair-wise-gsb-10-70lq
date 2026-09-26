// 回放规则层：纯函数，不接触存储与界面
// 记录结构：{ id, ts, seq, op, kind, payload }
//   ts  —— 提交时间（毫秒）；seq —— 提交顺序号，同一时刻按 seq 先后应用
//   kind —— node:add / node:remove / node:move / node:update / edge:add / edge:remove

export const sameEdge = (e, [a, b]) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a);

// 同一时刻的记录按提交顺序应用
export const sortRecords = records => [...records].sort((r1, r2) => r1.ts - r2.ts || r1.seq - r2.seq);

export const nextSeq = records => records.reduce((m, r) => Math.max(m, r.seq || 0), 0) + 1;

// 应用单条记录；成功返回 { state }，失败返回 { state, error }（state 保持原样）
export function applyRecord(state, rec) {
  const p = rec.payload || {};
  switch (rec.kind) {
    case 'node:add': {
      const node = p.node;
      if (!node || state.nodes.some(n => n.id === node.id)) return { state, error: `设备「${node && node.id}」已存在` };
      return { state: { ...state, nodes: [...state.nodes, node] } };
    }
    case 'node:remove': {
      if (!state.nodes.some(n => n.id === p.id)) return { state, error: `设备「${p.name || p.id}」不存在` };
      return { state: { nodes: state.nodes.filter(n => n.id !== p.id), edges: state.edges.filter(e => e[0] !== p.id && e[1] !== p.id) } };
    }
    case 'node:move': {
      if (!state.nodes.some(n => n.id === p.id)) return { state, error: `设备「${p.name || p.id}」不存在，无法移动` };
      return { state: { ...state, nodes: state.nodes.map(n => (n.id === p.id ? { ...n, x: p.x, y: p.y } : n)) } };
    }
    case 'node:update': {
      if (!state.nodes.some(n => n.id === p.id)) return { state, error: `设备「${p.name || p.id}」不存在，无法修改属性` };
      return { state: { ...state, nodes: state.nodes.map(n => (n.id === p.id ? { ...n, ...p.patch } : n)) } };
    }
    case 'edge:add': {
      const [a, b] = p.edge;
      const missing = [a, b].filter(id => !state.nodes.some(n => n.id === id));
      if (missing.length) return { state, error: `悬空线路 ${a} ↔ ${b}：设备「${missing.join('、')}」不存在` };
      if (state.edges.some(e => sameEdge(e, p.edge))) return { state }; // 重复连接：幂等跳过
      return { state: { ...state, edges: [...state.edges, [a, b]] } };
    }
    case 'edge:remove':
      return { state: { ...state, edges: state.edges.filter(e => !sameEdge(e, p.edge)) } }; // 幂等
    default:
      return { state, error: `未知记录类型 ${rec.kind}` };
  }
}

// 按 (ts, seq) 顺序重建某一时刻的整图；count 为应用的记录条数（0 = 初始状态）
export function rebuild(base, records, count = records.length) {
  let state = base;
  for (const rec of sortRecords(records).slice(0, count)) {
    const r = applyRecord(state, rec);
    if (r.error) break; // 记录在写入前已校验，正常不会走到这里
    state = r.state;
  }
  return state;
}

// 撤回中间记录：先移除该记录，再把后续记录按顺序重算。
// 重算中出现悬空线路等问题时停在问题记录，返回 ok:false 与 problemId，调用方保持当前图原样。
export function revokeRecord(base, records, id) {
  const sorted = sortRecords(records);
  const idx = sorted.findIndex(r => r.id === id);
  if (idx < 0) return { ok: false, error: '记录不存在' };
  const remaining = [...sorted.slice(0, idx), ...sorted.slice(idx + 1)];
  let state = base;
  for (const rec of remaining) {
    const r = applyRecord(state, rec);
    if (r.error) return { ok: false, error: `重算到第 ${rec.seq} 条（${describe(rec)}）时失败：${r.error}`, problemId: rec.id };
    state = r.state;
  }
  return { ok: true, records: remaining, revokedIndex: idx };
}

// 校验新记录能否写入“现在”（在最新图上试应用一次）
export function validateCommit(live, rec) {
  return applyRecord(live, rec).error || null;
}

export function describe(rec) {
  const p = rec.payload || {};
  switch (rec.kind) {
    case 'node:add': return `新增设备「${p.node.name}」`;
    case 'node:remove': return `删除设备「${p.name || p.id}」`;
    case 'node:move': return `移动「${p.name || p.id}」到 (${p.x}, ${p.y})`;
    case 'node:update': return `修改「${p.name || p.id}」属性：${Object.keys(p.patch).join('、')}`;
    case 'edge:add': return `连接 ${p.an || p.edge[0]} ↔ ${p.bn || p.edge[1]}`;
    case 'edge:remove': return `断开 ${p.an || p.edge[0]} ↔ ${p.bn || p.edge[1]}`;
    default: return rec.kind;
  }
}
