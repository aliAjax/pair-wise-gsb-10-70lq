// 引擎语义冒烟测试：node src/replay/engine.test.js
import {
  replay,
  resolveMarker,
  trialSetRevoked,
  nextSeq,
  emptyGraph,
} from './engine.js';

let pass = 0;
const ok = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    pass++;
  }
};

const base = emptyGraph();
const rec = (over) => ({
  id: over.id,
  type: over.type,
  payload: over.payload,
  time: over.time ?? 1000,
  seq: over.seq ?? 0,
  author: 'tester',
  revoked: false,
});

// 1) 同一时刻按提交顺序（seq）应用
{
  const recs = [
    rec({ id: 'a', type: 'add-node', seq: 2, time: 500, payload: { node: { id: 'A', x: 1, y: 1 } } }),
    rec({ id: 'b', type: 'add-node', seq: 0, time: 500, payload: { node: { id: 'B', x: 2, y: 2 } } }),
    rec({ id: 'c', type: 'add-node', seq: 1, time: 500, payload: { node: { id: 'C', x: 3, y: 3 } } }),
    rec({ id: 'd', type: 'add-edge', seq: 3, time: 500, payload: { edge: ['B', 'A'] } }),
  ];
  const r = replay(base, recs, null);
  ok(r.graph.nodes.map((n) => n.id).join() === 'B,C,A', 'same-time order by seq');
  ok(r.applied === 4 && !r.stoppedAt, 'all applied');
}

// 2) 时间轴定位到某一条（该条已应用），基线不应用任何记录
{
  const recs = [
    rec({ id: 'a', type: 'add-node', seq: 0, time: 100, payload: { node: { id: 'A' } } }),
    rec({ id: 'b', type: 'add-node', seq: 1, time: 200, payload: { node: { id: 'B' } } }),
  ];
  ok(replay(base, recs, { id: '' }).graph.nodes.length === 0, 'baseline empty');
  const at1 = replay(base, recs, { id: 'a', time: 100, seq: 0 });
  ok(at1.graph.nodes.length === 1 && at1.graph.nodes[0].id === 'A', 'seek to record 1');
}

// 3) 悬空线路：直接 add-edge 到不存在的端点 → 停在问题记录
{
  const recs = [
    rec({ id: 'a', type: 'add-node', seq: 0, time: 100, payload: { node: { id: 'A' } } }),
    rec({ id: 'b', type: 'add-edge', seq: 1, time: 200, payload: { edge: ['A', 'X'] } }),
    rec({ id: 'c', type: 'add-node', seq: 2, time: 300, payload: { node: { id: 'C' } } }),
  ];
  const r = replay(base, recs, null);
  ok(r.stoppedAt?.id === 'b', 'stops at dangling record');
  ok(r.graph.nodes.length === 1 && r.graph.edges.length === 1, 'graph frozen at problem point');
  ok(r.applied === 2, 'applied count = 2');
}

// 4) 撤回中间记录 → 后面记录重算（关联记录需一起撤回，否则悬空被拒）
{
  const recs = [
    rec({ id: 'a', type: 'add-node', seq: 0, time: 100, payload: { node: { id: 'A' } } }),
    rec({ id: 'b', type: 'add-node', seq: 1, time: 200, payload: { node: { id: 'B' } } }),
    rec({ id: 'e', type: 'add-edge', seq: 2, time: 250, payload: { edge: ['A', 'B'] } }),
    rec({ id: 'c', type: 'update-node', seq: 3, time: 300, payload: { id: 'A', before: {}, after: { name: 'A2' } } }),
  ];
  // 只撤回 B 的新增 → A-B 悬空，拒绝
  const only = trialSetRevoked(base, recs, ['b'], true, null);
  ok(only.invalid && only.stoppedAt.id === 'e', 'revoking add-node alone dangles its edge');
  // 设备与线路记录一起撤回 → 合法，后面的改名记录重算生效
  const t = trialSetRevoked(base, recs, ['b', 'e'], true, null);
  ok(!t.invalid, 'revoking node with its edge is valid');
  ok(t.graph.nodes.map((n) => n.id).join() === 'A', 'only A remains');
  ok(t.graph.nodes[0].name === 'A2', 'later record recomputed');
  ok(t.graph.edges.length === 0, 'edge revoked too');
}

// 5) 撤回会导致悬空 → 整笔拒绝，原记录不动
{
  // 撤回 B 的"新增设备"：add-node 直接消失，后续 A-B 线路失去端点
  const dangling = [
    rec({ id: 'a', type: 'add-node', seq: 0, time: 100, payload: { node: { id: 'A' } } }),
    rec({ id: 'b', type: 'add-node', seq: 1, time: 200, payload: { node: { id: 'B' } } }),
    rec({ id: 'e', type: 'add-edge', seq: 2, time: 250, payload: { edge: ['A', 'B'] } }),
  ];
  const t = trialSetRevoked(base, dangling, ['b'], true, null);
  ok(t.invalid, 'revoking creation of B leaves A-B dangling => rejected');
  ok(t.stoppedAt.id === 'e' && t.edge.includes('B'), 'reports problem record & edge');
  ok(dangling[1].revoked === false, 'original records untouched');
}

// 5b) 撤回 remove-node（即恢复一条删除记录为生效）语义：remove 会带走边，合法
{
  const recs = [
    rec({ id: 'a', type: 'add-node', seq: 0, time: 100, payload: { node: { id: 'A' } } }),
    rec({ id: 'b', type: 'add-node', seq: 1, time: 200, payload: { node: { id: 'B' } } }),
    rec({ id: 'e', type: 'add-edge', seq: 2, time: 250, payload: { edge: ['A', 'B'] } }),
    rec({ id: 'd', type: 'remove-node', seq: 3, time: 300, payload: { id: 'B' } }),
  ];
  // 先撤回删除记录（让 B 活回来）—— 边仍在，但边的记录 e 先于 d，d 被撤回后边保留
  const t = trialSetRevoked(base, recs, ['d'], true, null);
  ok(!t.invalid && t.graph.nodes.length === 2 && t.graph.edges.length === 1,
    'un-reviving deletion restores node with its edge');
}

// 6) 游标指向的记录被撤回后，resolveMarker 回退到不晚于它的最后一条
{
  const recs = [
    rec({ id: 'a', type: 'add-node', seq: 0, time: 100, payload: { node: { id: 'A' } } }),
    rec({ id: 'b', type: 'add-node', seq: 1, time: 200, payload: { node: { id: 'B' } } }),
  ];
  const revoked = recs.map((r) => (r.id === 'b' ? { ...r, revoked: true } : r));
  const m = resolveMarker(revoked, { id: 'b', time: 200, seq: 1 });
  ok(m.id === 'a', 'marker falls back to previous record');
  ok(resolveMarker(revoked, null) === null, 'null means live');
}

// 7) seq 单调递增，撤回不复用
ok(nextSeq([{ seq: 5 }, { seq: 2 }]) === 6, 'next seq monotonic');

// 8) 位置记录重放
{
  const recs = [
    rec({ id: 'a', type: 'add-node', seq: 0, time: 100, payload: { node: { id: 'A', x: 0, y: 0 } } }),
    rec({ id: 'm', type: 'move-node', seq: 1, time: 200, payload: { id: 'A', from: { x: 0, y: 0 }, to: { x: 99, y: 88 } } }),
  ];
  const r = replay(base, recs, null);
  ok(r.graph.nodes[0].x === 99 && r.graph.nodes[0].y === 88, 'move applied');
}

console.log(`${pass} checks passed`);
