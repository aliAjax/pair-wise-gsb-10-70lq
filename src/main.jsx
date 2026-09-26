import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import {
  activeRecords,
  replay,
  resolveMarker,
  trialSetRevoked,
} from './replay/engine';
import { loadState, saveState, makeRecord } from './replay/store';

const TYPE_ICON = (t) =>
  t === 'router' ? '◉' : t === 'switch' ? '▦' : t === 'server' ? '▣' : '▱';
const TYPE_LABEL = {
  router: '路由器',
  switch: '交换机',
  server: '服务器',
  device: '终端设备',
};
const TYPE_LIST = [
  ['router', '◉', '路由器'],
  ['switch', '▦', '交换机'],
  ['server', '▣', '服务器'],
  ['device', '▱', '终端设备'],
];

const fmtTime = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
};

// 记录的中文描述（对照"现在"的图取名）
const describe = (r, nowGraph) => {
  const nameOf = (id) => nowGraph.nodes.find((n) => n.id === id)?.name || id;
  switch (r.type) {
    case 'add-node':
      return `新增设备「${r.payload.node.name}」`;
    case 'remove-node':
      return `删除设备「${nameOf(r.payload.id)}」`;
    case 'update-node': {
      const labels = { name: '名称', ip: 'IP', type: '类型' };
      const keys = Object.keys(r.payload.after);
      return `修改「${nameOf(r.payload.id)}」的${keys
        .map((k) => labels[k] || k)
        .join('、')}`;
    }
    case 'move-node':
      return `移动「${nameOf(r.payload.id)}」的位置`;
    case 'add-edge':
      return `连接 ${nameOf(r.payload.edge[0])} ↔ ${nameOf(
        r.payload.edge[1]
      )}`;
    case 'remove-edge':
      return `断开 ${nameOf(r.payload.edge[0])} ↔ ${nameOf(
        r.payload.edge[1]
      )}`;
    default:
      return r.type;
  }
};

function App() {
  const [state, setState] = useState(loadState); // base/records/seq/marker/author
  const [selected, setSelected] = useState('gw');
  const [tool, setTool] = useState('select');
  const [notice, setNotice] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [drag, setDrag] = useState(null);
  const [playing, setPlaying] = useState(false);
  const board = useRef();
  const toastTimer = useRef();

  const { base, records, marker, author } = state;
  const liveMarker = resolveMarker(records, marker);
  const view = useMemo(
    () => replay(base, records, liveMarker),
    [base, records, liveMarker]
  );
  const nowView = useMemo(() => replay(base, records, null), [base, records]);
  const list = useMemo(() => activeRecords(records), [records]);

  // 保存层：任何变化都落盘（含上次查看的时间点，重开继续看）
  useEffect(() => {
    saveState(state);
  }, [state]);

  const flash = (msg) => {
    setNotice(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(''), 3200);
  };

  const isLive = liveMarker === null && !view.stoppedAt;

  // 提交一条新记录：始终写进"现在"，旧记录不动
  const commit = (type, payload) => {
    setState((s) => {
      const rec = makeRecord(type, payload, s.author || '当前用户', s.records);
      return { ...s, records: [...s.records, rec], seq: rec.seq + 1 };
    });
  };

  // ---- 编辑动作（基于当前看到的图取值，记录追加在现在）----
  const graph = view.graph;

  // 新记录写进"现在"，因此合法性以"现在"的图为准，避免往现在写入死记录/悬空线路
  const nowGraph = nowView.graph;
  const inNow = (id) => nowGraph.nodes.some((n) => n.id === id);

  const addNodeOfType = (type) => {
    const id = 'node' + Date.now().toString(36);
    const node = {
      id,
      name: TYPE_LABEL[type],
      type,
      x: 480 + Math.round(Math.random() * 40),
      y: 300 + Math.round(Math.random() * 40),
      ip: '192.168.0.2',
    };
    commit('add-node', { node });
    setSelected(id);
    setTool('select');
    flash(isLive ? '已添加设备' : '已添加设备：记录写入现在，回放视角不变');
  };

  const updateNode = (n, k, v) => {
    if (v === n[k]) return;
    // 设备可能在现在已不存在（回放的是更早状态），此时不能往现在写属性记录
    if (!inNow(n.id)) {
      flash('该设备在"现在"不存在，无法把修改写入现在');
      return;
    }
    commit('update-node', {
      id: n.id,
      before: { [k]: n[k] },
      after: { [k]: v },
    });
  };

  const removeNode = (n) => {
    if (!inNow(n.id)) {
      flash('该设备在"现在"不存在，无需再删除');
      return;
    }
    commit('remove-node', { id: n.id });
    setSelected(graph.nodes.find((x) => x.id !== n.id)?.id || '');
    flash(isLive ? '设备已删除' : '设备删除已记入现在，回放视角不变');
  };

  const connect = (n) => {
    if (!n) return;
    const other = prompt('输入要连接的设备 ID（例如 sw1）');
    if (!other) return;
    if (!inNow(n.id)) return flash('该设备在"现在"不存在，无法在现在创建连接');
    if (!inNow(other)) return flash('「现在」没有该设备，不能产生悬空线路');
    if (other === n.id) return flash('不能连接自身');
    if (
      nowGraph.edges.some(
        (e) =>
          (e[0] === n.id && e[1] === other) ||
          (e[1] === n.id && e[0] === other)
      )
    )
      return flash('该连接在"现在"已存在');
    commit('add-edge', { edge: [n.id, other] });
    flash(isLive ? '连接已创建' : '连接已记入现在，回放视角不变');
  };

  const disconnect = (edge) => {
    const existsInNow = nowGraph.edges.some(
      (e) =>
        (e[0] === edge[0] && e[1] === edge[1]) ||
        (e[1] === edge[0] && e[0] === edge[1])
    );
    if (!existsInNow) {
      flash('该连接在"现在"不存在，无需断开');
      return;
    }
    commit('remove-edge', { edge: [...edge] });
  };

  const onNodeDown = (e, n) => {
    e.stopPropagation();
    setSelected(n.id);
    setDrag({ id: n.id, startX: n.x, startY: n.y, x: n.x, y: n.y });
  };

  const onMove = (e) => {
    if (!drag) return;
    const r = board.current.getBoundingClientRect();
    setDrag({
      ...drag,
      x: Math.max(35, e.clientX - r.left),
      y: Math.max(35, e.clientY - r.top),
    });
  };

  const onUp = () => {
    if (!drag) return;
    const moved = Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 2;
    if (moved) {
      if (inNow(drag.id)) {
        commit('move-node', {
          id: drag.id,
          from: { x: drag.startX, y: drag.startY },
          to: { x: drag.x, y: drag.y },
        });
        if (!isLive) flash('位置调整已记入现在，回放视角不变');
      } else {
        flash('该设备在"现在"不存在，无法把移动写入现在');
      }
    }
    setDrag(null);
  };

  // ---- 时间轴 ----
  // 位置 0 = 基线；1..n = 第 k 条有效记录；n = 现在
  const markerIndex = !liveMarker
    ? list.length
    : !liveMarker.id
      ? 0
      : list.findIndex(
          (r) => r.time === liveMarker.time && r.seq === liveMarker.seq
        ) + 1;

  const seek = (idx) => {
    setPlaying(false);
    setState((s) => ({
      ...s,
      marker:
        idx === 0
          ? { id: '' }
          : idx >= list.length
            ? null
            : (() => {
                const r = list[idx - 1];
                return { id: r.id, time: r.time, seq: r.seq };
              })(),
    }));
  };

  useEffect(() => {
    if (!playing) return;
    if (markerIndex >= list.length) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => seek(markerIndex + 1), 700);
    return () => clearTimeout(t);
  }, [playing, markerIndex, list.length]);

  // ---- 撤回 / 恢复（试算，悬空则整笔放弃）----
  const toggleRevoke = (r) => {
    const revoke = !r.revoked;
    const trial = trialSetRevoked(base, records, [r.id], revoke, liveMarker);
    if (trial.invalid) {
      flash(
        `已阻止${revoke ? '撤回' : '恢复'}：应用到「${describe(
          trial.stoppedAt,
          nowView.graph
        )}」时线路 ${trial.edge[0]}—${
          trial.edge[1]
        } 悬空，当前图保持原样`
      );
      return;
    }
    setState((s) => ({
      ...s,
      records: trial.records,
      marker: trial.marker,
    }));
    flash(revoke ? '已撤回该记录，其后记录已重算' : '已恢复该记录，其后记录已重算');
  };

  const validate = () => {
    const linked = new Set(graph.edges.flat());
    const isolated = graph.nodes.filter((n) => !linked.has(n.id));
    flash(
      isolated.length
        ? `发现 ${isolated.length} 个孤立节点`
        : '拓扑检查通过：没有孤立节点'
    );
  };

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' })
    );
    a.download = 'network-topology.json';
    a.click();
    flash('当前视图 JSON 已导出');
  };

  const save = () => {
    saveState(state);
    flash('拓扑变更历史已保存');
  };

  const node = graph.nodes.find((n) => n.id === selected) || null;
  const currentRec = markerIndex > 0 && markerIndex <= list.length ? list[markerIndex - 1] : null;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">⌁</span>
          <div>
            <strong>NETSCAPE</strong>
            <small>TOPOLOGY STUDIO</small>
          </div>
        </div>
        <div className="file">
          <span className={'dot' + (isLive ? '' : ' past')}></span>
          <div>
            <strong>office-network.json</strong>
            <small>
              {isLive ? '查看中：现在' : `查看中：${fmtTime(currentRec?.time)}`}
            </small>
          </div>
        </div>
        <div className="top-actions">
          <button onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? '✕ 关闭记录' : '🕓 变更记录'}
          </button>
          <button onClick={validate}>✓ 检查</button>
          <button onClick={exportJson}>↓ 导出</button>
          <button className="save" onClick={save}>
            保存更改
          </button>
        </div>
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <span>工具</span>
          <button
            className={tool === 'select' ? 'on' : ''}
            onClick={() => setTool('select')}
          >
            ↖ 选择
          </button>
          <button onClick={() => connect(node)}>⌁ 连接</button>
          <button onClick={() => addNodeOfType('device')}>＋ 设备</button>
        </div>
        <div className="tool-group">
          <span className="hint">
            {records.length} 条变更记录 · {records.filter((r) => r.revoked).length} 条已撤回
          </span>
        </div>
      </div>

      <div className="workspace">
        <aside className="inventory">
          <div className="section-title">
            <span>设备库</span>
            <small>{graph.nodes.length} 个节点</small>
          </div>
          <div className="device-types">
            {TYPE_LIST.map(([t, i, l]) => (
              <button onClick={() => addNodeOfType(t)} key={t}>
                <i className={t}>{i}</i>
                {l}
                <span>＋</span>
              </button>
            ))}
          </div>
          <div className="section-title nodes-head">
            <span>图中节点</span>
            <small>点击查看</small>
          </div>
          <div className="node-list">
            {graph.nodes.map((n) => (
              <button
                className={selected === n.id ? 'sel' : ''}
                onClick={() => setSelected(n.id)}
                key={n.id}
              >
                <i className={n.type}>{TYPE_ICON(n.type)}</i>
                <span>
                  <strong>{n.name}</strong>
                  <small>{n.ip}</small>
                </span>
                <b>›</b>
              </button>
            ))}
          </div>
        </aside>

        <section className="canvas-wrap">
          {!isLive && (
            <div className="past-banner">
              <span>
                ⏪ 回放中：当前是{markerIndex === 0 ? '初始基线' : fmtTime(currentRec.time)}
                的状态。继续编辑仍会写入<b>现在</b>并生成新记录，旧记录不改动。
              </span>
              <button onClick={() => seek(list.length)}>回到现在 →</button>
            </div>
          )}
          <div
            className="canvas"
            ref={board}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
          >
            {graph.edges.map(([a, b], i) => {
              const n1 = graph.nodes.find((n) => n.id === a);
              const n2 = graph.nodes.find((n) => n.id === b);
              if (!n1 || !n2) return null;
              const p1 = drag && drag.id === a ? drag : n1;
              const p2 = drag && drag.id === b ? drag : n2;
              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const len = Math.hypot(dx, dy);
              const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <div
                  className="edge"
                  key={i}
                  style={{
                    left: p1.x,
                    top: p1.y,
                    width: len,
                    transform: `rotate(${ang}deg)`,
                  }}
                >
                  <span></span>
                </div>
              );
            })}
            {graph.nodes.map((n) => {
              const p = drag && drag.id === n.id ? drag : n;
              return (
                <button
                  className={
                    'node ' + n.type + (selected === n.id ? ' picked' : '')
                  }
                  style={{ left: p.x - 42, top: p.y - 31 }}
                  onMouseDown={(e) => onNodeDown(e, n)}
                  onClick={() => setSelected(n.id)}
                  key={n.id}
                >
                  <i>{TYPE_ICON(n.type)}</i>
                  <strong>{n.name}</strong>
                  <small>{n.ip}</small>
                </button>
              );
            })}
            <div className="legend">
              <span>
                <i className="router"></i>路由器
              </span>
              <span>
                <i className="switch"></i>交换机
              </span>
              <span>
                <i className="server"></i>服务器
              </span>
            </div>
          </div>
          <div className="canvas-footer">
            <span>
              {isLive
                ? '拖动节点调整位置'
                : '回放视角只读其形，你的改动会计入现在'} · {graph.edges.length} 条连接
            </span>
            <span>坐标系：画布局部</span>
          </div>
        </section>

        <aside className="inspector">
          <div className="section-title">
            <span>属性</span>
            <small>{node ? TYPE_LABEL[node.type] : '—'}</small>
          </div>
          {node ? (
            <>
              <label>
                设备名称
                <input
                  value={node.name}
                  onChange={(e) => updateNode(node, 'name', e.target.value)}
                />
              </label>
              <label>
                IP 地址
                <input
                  value={node.ip}
                  onChange={(e) => updateNode(node, 'ip', e.target.value)}
                />
              </label>
              <label>
                设备类型
                <select
                  value={node.type}
                  onChange={(e) => updateNode(node, 'type', e.target.value)}
                >
                  <option value="router">路由器</option>
                  <option value="switch">交换机</option>
                  <option value="server">服务器</option>
                  <option value="device">终端设备</option>
                </select>
              </label>
              <div className="inspector-actions">
                <button onClick={() => connect(node)}>⌁ 添加连接</button>
                <button className="danger" onClick={() => removeNode(node)}>
                  删除设备
                </button>
              </div>
              <div className="connections">
                <div className="section-title">
                  <span>连接</span>
                  <small>
                    {graph.edges.filter((e) => e.includes(node.id)).length} 条
                  </small>
                </div>
                {graph.edges
                  .filter((e) => e.includes(node.id))
                  .map((e, i) => {
                    const other = graph.nodes.find(
                      (n) => n.id === (e[0] === node.id ? e[1] : e[0])
                    );
                    return (
                      <div className="connection" key={i}>
                        <span className={'mini ' + other?.type}></span>
                        <strong>{other?.name}</strong>
                        <small
                          className="cut"
                          title="撤回这条连接记录"
                          onClick={() => disconnect(e)}
                        >
                          断开 ✕
                        </small>
                      </div>
                    );
                  })}
              </div>
            </>
          ) : (
            <p>选择一个设备</p>
          )}
        </aside>
      </div>

      {showHistory && (
        <div className="history-panel">
          <div className="section-title">
            <span>变更记录（时间 / 操作人 / 内容）</span>
            <small>{records.length} 条</small>
          </div>
          <div className="history-list">
            {records.length === 0 && <p className="empty">还没有变更记录</p>}
            {[...records]
              .sort((a, b) => a.time - b.time || a.seq - b.seq)
              .map((r) => (
                <div
                  key={r.id}
                  className={
                    'history-item' +
                    (r.revoked ? ' revoked' : '') +
                    (currentRec && currentRec.id === r.id ? ' current' : '') +
                    (view.stoppedAt?.id === r.id ? ' problem' : '')
                  }
                  onClick={() => {
                    if (r.revoked) return;
                    const idx = list.findIndex((x) => x.id === r.id);
                    if (idx >= 0) seek(idx + 1);
                  }}
                >
                  <div>
                    <strong>{describe(r, nowView.graph)}</strong>
                    <small>
                      {fmtTime(r.time)} · {r.author} · #{r.seq}
                      {r.revoked ? ' · 已撤回' : ''}
                    </small>
                  </div>
                  <button
                    className={r.revoked ? '' : 'danger'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleRevoke(r);
                    }}
                  >
                    {r.revoked ? '恢复' : '撤回'}
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="timeline">
        <div className="tl-controls">
          <button onClick={() => seek(0)} title="回到初始基线">
            ⏮
          </button>
          <button onClick={() => seek(Math.max(0, markerIndex - 1))}>
            ‹
          </button>
          <button
            onClick={() =>
              markerIndex >= list.length ? seek(0) : setPlaying(true)
            }
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => seek(Math.min(list.length, markerIndex + 1))}
          >
            ›
          </button>
          <button onClick={() => seek(list.length)} title="跳到现在">
            现在
          </button>
        </div>
        <div className="tl-slider">
          <span className="tl-time">
            {markerIndex === 0
              ? '初始基线'
              : markerIndex >= list.length
                ? '现在'
                : fmtTime(currentRec?.time)}
          </span>
          <input
            type="range"
            min={0}
            max={list.length}
            value={markerIndex}
            step={1}
            onChange={(e) => seek(Number(e.target.value))}
          />
          <span className="tl-step">
            {markerIndex} / {list.length}
          </span>
          {currentRec && (
            <span className="tl-rec">
              {describe(currentRec, nowView.graph)} · {currentRec.author}
            </span>
          )}
        </div>
        <label className="tl-author">
          操作人
          <input
            value={author || ''}
            placeholder="当前用户"
            onChange={(e) =>
              setState((s) => ({ ...s, author: e.target.value }))
            }
          />
        </label>
      </div>

      {view.stoppedAt && (
        <div className="toast warn">
          重放在「{describe(view.stoppedAt, nowView.graph)}」处停止：出现悬空线路
        </div>
      )}
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
