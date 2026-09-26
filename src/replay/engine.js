// 变更回放引擎 —— 纯规则层
// 不依赖 React、localStorage 或任何界面逻辑，只负责：
// 1. 按 (时间, 提交顺序) 重放记录，还原任意时刻的整图；
// 2. 撤回/恢复记录后从头重算；
// 3. 重算出现悬空线路（端点缺失）时停在问题记录上。

// 记录类型：
//   add-node      新增设备      payload: { node }
//   remove-node   删除设备      payload: { id }
//   update-node   修改属性      payload: { id, before, after }
//   move-node     移动位置      payload: { id, from:{x,y}, to:{x,y} }
//   add-edge      新增线路      payload: { edge:[id,id] }
//   remove-edge   删除线路      payload: { edge:[id,id] }
// 记录结构：{ id, type, payload, time(ms), seq(提交顺序), author, revoked }

export const emptyGraph = () => ({ nodes: [], edges: [] });

export const cloneGraph = (g) => ({
  nodes: g.nodes.map((n) => ({ ...n })),
  edges: g.edges.map((e) => [...e]),
});

const sameEdge = (a, b) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

// 有效记录：未撤回，按时间、再按提交顺序排列（同一时刻先提交的先应用）
export function activeRecords(records) {
  return records
    .filter((r) => !r.revoked)
    .slice()
    .sort((a, b) => a.time - b.time || a.seq - b.seq);
}

// 在已有的图上应用单条记录（仅用于重放，不做合法性校验）
function applyRecord(graph, rec) {
  const p = rec.payload;
  switch (rec.type) {
    case 'add-node':
      if (!graph.nodes.some((n) => n.id === p.node.id)) {
        graph.nodes.push({ ...p.node });
      }
      break;
    case 'remove-node':
      graph.nodes = graph.nodes.filter((n) => n.id !== p.id);
      // 设备消失时其线路一并消失，保持图内自洽
      graph.edges = graph.edges.filter((e) => !e.includes(p.id));
      break;
    case 'update-node':
      graph.nodes = graph.nodes.map((n) =>
        n.id === p.id ? { ...n, ...p.after } : n
      );
      break;
    case 'move-node':
      graph.nodes = graph.nodes.map((n) =>
        n.id === p.id ? { ...n, x: p.to.x, y: p.to.y } : n
      );
      break;
    case 'add-edge':
      if (!graph.edges.some((e) => sameEdge(e, p.edge))) {
        graph.edges.push([...p.edge]);
      }
      break;
    case 'remove-edge':
      graph.edges = graph.edges.filter((e) => !sameEdge(e, p.edge));
      break;
    default:
      break;
  }
  return graph;
}

// 找图中第一条悬空线路（端点设备不存在）
export function danglingEdge(graph) {
  return graph.edges.find(
    (e) => !graph.nodes.some((n) => n.id === e[0]) ||
           !graph.nodes.some((n) => n.id === e[1])
  ) || null;
}

// 游标标记：
//   null           现在（最新）
//   { id: '' }     初始基线（一条记录都不应用）
//   { id, time, seq } 停在某条记录（该记录已应用）
const atOrBefore = (rec, marker) =>
  rec.time < marker.time ||
  (rec.time === marker.time && rec.seq <= marker.seq);

// 当游标指向的记录已不存在（被撤回或删除）时，回退到不晚于它的最后一条
export function resolveMarker(records, marker) {
  if (!marker) return null;
  if (!marker.id) return { id: '' };
  const list = activeRecords(records);
  const hit = list.find((r) => r.id === marker.id);
  if (hit) return { id: hit.id, time: hit.time, seq: hit.seq };
  const fallback = list
    .filter((r) =>
      marker.time == null ? r.seq <= (marker.seq ?? 0) : atOrBefore(r, marker)
    )
    .pop();
  return fallback
    ? { id: fallback.id, time: fallback.time, seq: fallback.seq }
    : { id: '' };
}

// 核心重放：从基线出发顺序应用记录，直到游标处；
// 一旦出现悬空线路，停在问题记录，已应用的部分保持原样返回。
export function replay(base, records, marker) {
  const graph = cloneGraph(base);
  const list = activeRecords(records);
  const stop = !marker
    ? list.length
    : marker.id
      ? list.findIndex(
          (r) => r.time === marker.time && r.seq === marker.seq
        ) + 1
      : 0; // 基线：不应用任何记录
  const safeStop = Math.max(0, Math.min(stop, list.length));
  let stoppedAt = null;

  for (let i = 0; i < safeStop; i++) {
    applyRecord(graph, list[i]);
    if (danglingEdge(graph)) {
      stoppedAt = list[i];
      return { graph, stoppedAt, applied: i + 1, total: list.length };
    }
  }
  return { graph, stoppedAt: null, applied: safeStop, total: list.length };
}

// 撤回 / 恢复的试算：替换记录的 revoked 标记后整体重算
// 出现悬空线路 => invalid=true，调用方放弃本次改动、当前图保持原样
export function trialSetRevoked(base, records, ids, revoked, marker) {
  const set = new Set(ids);
  const next = records.map((r) =>
    set.has(r.id) ? { ...r, revoked } : r
  );
  const result = replay(base, next, null); // 重算总是算到"现在"
  if (result.stoppedAt) {
    return {
      invalid: true,
      stoppedAt: result.stoppedAt,
      edge: danglingEdge(result.graph),
    };
  }
  return {
    invalid: false,
    records: next,
    graph: result.graph,
    marker: revoked ? resolveMarker(next, marker) : marker,
  };
}

// 下一条记录的提交顺序号（单调递增，撤回/恢复都不复用）
export const nextSeq = (records) =>
  records.reduce((m, r) => Math.max(m, r.seq), -1) + 1;
