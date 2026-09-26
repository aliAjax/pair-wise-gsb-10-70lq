import React,{useEffect,useMemo,useRef,useState}from'react';import{createRoot}from'react-dom/client';import'./styles.css';
import{sortRecords,rebuild,revokeRecord,validateCommit,nextSeq,describe,sameEdge}from'./replay.js';
import{loadReplay,saveReplay,loadOperator,saveOperator}from'./store.js';
const fmtTime=ts=>{const d=new Date(ts),p=n=>String(n).padStart(2,'0');return`${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`};
const icon=t=>t==='router'?'◉':t==='switch'?'▦':t==='server'?'▣':'▱';
function App(){
  const[replay,setReplay]=useState(loadReplay);
  const[operator,setOperator]=useState(loadOperator);
  const[selected,setSelected]=useState('gw');
  const[tool,setTool]=useState('select');
  const[notice,setNotice]=useState('');
  const[drag,setDrag]=useState(null);
  const[draft,setDraft]=useState({});
  const[showHistory,setShowHistory]=useState(false);
  const[problemId,setProblemId]=useState(null);
  const board=useRef();
  const sorted=useMemo(()=>sortRecords(replay.records),[replay.records]);
  const live=useMemo(()=>rebuild(replay.base,sorted),[replay.base,sorted]);
  const cursor=Math.min(replay.cursor,sorted.length);
  const viewingPast=cursor<sorted.length;
  const view=useMemo(()=>viewingPast?rebuild(replay.base,sorted,cursor):live,[viewingPast,replay.base,sorted,cursor,live]);
  const shown=drag?{...view,nodes:view.nodes.map(n=>n.id===drag.id?{...n,x:drag.x,y:drag.y}:n)}:view;
  useEffect(()=>saveReplay(replay),[replay]);
  useEffect(()=>saveOperator(operator),[operator]);
  useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t)},[notice]);
  useEffect(()=>setDraft({}),[selected]);
  const node=view.nodes.find(n=>n.id===selected)||view.nodes[0];
  const cursorLabel=cursor===0?(sorted.length?'初始状态':'初始状态 · 现在'):fmtTime(sorted[cursor-1].ts)+(viewingPast?'':' · 现在');
  // 所有编辑都写入“现在”：在最新图上校验，通过后追加新记录，旧记录不动
  const commit=(kind,payload,okMsg)=>{
    const rec={id:'r'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),ts:Date.now(),seq:nextSeq(replay.records),op:operator,kind,payload};
    const err=validateCommit(live,rec);
    if(err){setNotice(`未写入：${err}`);return false}
    setProblemId(null);
    setReplay(r=>({...r,records:[...r.records,rec],cursor:r.records.length+1}));
    if(okMsg)setNotice(viewingPast?okMsg+'（已写入“现在”，生成新记录）':okMsg);
    return true
  };
  const addNode=(type='device',label='新设备')=>{const id='node'+Date.now();if(commit('node:add',{node:{id,name:label,type,x:500,y:300,ip:'192.168.0.10'}},'已添加设备')){setSelected(id);setTool('select')}};
  const connect=()=>{if(!node)return;const other=prompt('输入要连接的设备 ID（例如 sw1）');if(!other||other===node.id)return;const target=live.nodes.find(n=>n.id===other);if(!target){setNotice(`设备 ${other} 在当前时间不存在`);return}if(live.edges.some(e=>sameEdge(e,[node.id,other]))){setNotice('连接已存在');return}commit('edge:add',{edge:[node.id,other],an:node.name,bn:target.name},'连接已创建')};
  const removeNode=()=>{if(!node)return;if(commit('node:remove',{id:node.id,name:node.name},'设备已删除'))setSelected(live.nodes.find(n=>n.id!==node.id)?.id)};
  const removeEdge=e=>{const[a,b]=e;if(!live.edges.some(x=>sameEdge(x,e))){setNotice('该线路在当前时间已不存在');return}const an=live.nodes.find(n=>n.id===a)?.name||a,bn=live.nodes.find(n=>n.id===b)?.name||b;commit('edge:remove',{edge:[a,b],an,bn},`已断开 ${an} ↔ ${bn}`)};
  const blurField=k=>{const v=draft[k];if(v===undefined||!node)return;setDraft(d=>{const c={...d};delete c[k];return c});const ln=live.nodes.find(n=>n.id===node.id);if(ln&&ln[k]!==v)commit('node:update',{id:node.id,name:node.name,patch:{[k]:v}},'属性已更新')};
  const move=e=>{if(!drag)return;const r=board.current.getBoundingClientRect();setDrag({...drag,x:Math.max(35,e.clientX-r.left),y:Math.max(35,e.clientY-r.top)})};
  const endDrag=()=>{if(drag){const n=view.nodes.find(x=>x.id===drag.id),x=Math.round(drag.x),y=Math.round(drag.y);if(n&&(n.x!==x||n.y!==y))commit('node:move',{id:drag.id,name:n.name,x,y},'位置已更新')}setDrag(null)};
  // 撤回中间记录：重算失败（如悬空线路）时停在问题记录，当前图保持原样
  const revoke=id=>{const res=revokeRecord(replay.base,replay.records,id);if(!res.ok){setProblemId(res.problemId||null);setShowHistory(true);setNotice(`撤回失败：${res.error}`);return}setProblemId(null);setReplay(r=>({...r,records:res.records,cursor:Math.max(0,Math.min(r.cursor-(res.revokedIndex<r.cursor?1:0),res.records.length))}));setNotice('记录已撤回，后续记录已重算')};
  const save=()=>setNotice('拓扑、变更记录与回放位置已自动保存');
  const exportJson=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(shown,null,2)],{type:'application/json'}));a.download='network-topology.json';a.click();setNotice(viewingPast?'已导出当前时刻的 JSON':'JSON 已导出')};
  const validate=()=>{const linked=new Set(shown.edges.flat());const isolated=shown.nodes.filter(n=>!linked.has(n.id));setNotice(isolated.length?`发现 ${isolated.length} 个孤立节点`:'拓扑检查通过：没有孤立节点')};
  return <div className="app"><header><div className="brand"><span className="brand-mark">⌁</span><div><strong>NETSCAPE</strong><small>TOPOLOGY STUDIO</small></div></div><div className="file"><span className="dot"></span><div><strong>office-network.json</strong><small>最近保存：刚刚</small></div></div><div className="top-actions"><button onClick={validate}>✓ 检查</button><button onClick={exportJson}>↓ 导出</button><button className="save" onClick={save}>保存更改</button></div></header>
  <div className="toolbar"><div className="tool-group"><span>工具</span><button className={tool==='select'?'on':''} onClick={()=>setTool('select')}>↖ 选择</button><button className={tool==='connect'?'on':''} onClick={()=>{setTool('connect');connect()}}>⌁ 连接</button><button onClick={()=>addNode()}>＋ 设备</button></div><div className="tool-group zoom"><button>−</button><span>100%</span><button>＋</button><button onClick={()=>setNotice('画布已居中')}>⌗</button></div></div>
  {viewingPast&&<div className="past-banner">正在回放历史时刻（{cursorLabel}）· 此时的编辑会写入“现在”并生成新记录，旧记录不受影响</div>}
  <div className="workspace"><aside className="inventory"><div className="section-title"><span>设备库</span><small>{view.nodes.length} 个节点</small></div><div className="device-types">{[['router','◉','路由器'],['switch','▦','交换机'],['server','▣','服务器'],['device','▱','终端设备']].map(([t,i,l])=><button onClick={()=>addNode(t,l)} key={t}><i className={t}>{i}</i>{l}<span>＋</span></button>)}</div><div className="section-title nodes-head"><span>图中节点</span><small>点击查看</small></div><div className="node-list">{view.nodes.map(n=><button className={selected===n.id?'sel':''} onClick={()=>setSelected(n.id)} key={n.id}><i className={n.type}>{icon(n.type)}</i><span><strong>{n.name}</strong><small>{n.ip}</small></span><b>›</b></button>)}</div></aside>
  <section className="canvas-wrap"><div className="canvas" ref={board} onMouseMove={move} onMouseUp={endDrag} onMouseLeave={endDrag}>{shown.edges.map(([a,b],i)=>{const n1=shown.nodes.find(n=>n.id===a),n2=shown.nodes.find(n=>n.id===b);if(!n1||!n2)return null;const dx=n2.x-n1.x,dy=n2.y-n1.y,len=Math.hypot(dx,dy),ang=Math.atan2(dy,dx)*180/Math.PI;return <div className="edge" key={i} style={{left:n1.x,top:n1.y,width:len,transform:`rotate(${ang}deg)`}}><span></span></div>})}{shown.nodes.map(n=><button className={'node '+n.type+(selected===n.id?' picked':'')} style={{left:n.x-42,top:n.y-31}} onMouseDown={e=>{e.stopPropagation();setSelected(n.id);setDrag({id:n.id,x:n.x,y:n.y})}} onClick={()=>setSelected(n.id)} key={n.id}><i>{icon(n.type)}</i><strong>{n.name}</strong><small>{n.ip}</small></button>)}<div className="legend"><span><i className="router"></i>路由器</span><span><i className="switch"></i>交换机</span><span><i className="server"></i>服务器</span></div></div><div className="canvas-footer"><span>拖动节点调整位置 · {shown.edges.length} 条连接</span><span>{viewingPast?`回放中：${cursorLabel}`:'坐标系：画布局部'}</span></div></section>
  <aside className="inspector"><div className="section-title"><span>属性</span><small>{node?.type}</small></div>{node?<><label>设备名称<input value={draft.name??node.name} onChange={e=>setDraft({...draft,name:e.target.value})} onBlur={()=>blurField('name')}/></label><label>IP 地址<input value={draft.ip??node.ip} onChange={e=>setDraft({...draft,ip:e.target.value})} onBlur={()=>blurField('ip')}/></label><label>设备类型<select value={node.type} onChange={e=>commit('node:update',{id:node.id,name:node.name,patch:{type:e.target.value}},'类型已更新')}><option value="router">路由器</option><option value="switch">交换机</option><option value="server">服务器</option><option value="device">终端设备</option></select></label><div className="inspector-actions"><button onClick={connect}>⌁ 添加连接</button><button className="danger" onClick={removeNode}>删除设备</button></div><div className="connections"><div className="section-title"><span>连接</span><small>{view.edges.filter(e=>e.includes(node.id)).length} 条</small></div>{view.edges.filter(e=>e.includes(node.id)).map((e,i)=>{const other=view.nodes.find(n=>n.id===(e[0]===node.id?e[1]:e[0]));return <div className="connection" key={i}><span className={'mini '+other?.type}></span><strong>{other?.name}</strong><small>在线</small><button className="edge-del" title="断开这条线路" onClick={()=>removeEdge(e)}>✕</button></div>})}</div></>:<p>选择一个设备</p>}</aside></div>
  <footer className="replay-bar"><div className="replay-status"><span className={'replay-badge'+(viewingPast?' past':'')}>{viewingPast?'历史回放':'现在'}</span><span className="replay-time">{cursorLabel}</span></div><span className="replay-end">初始</span><input className="replay-slider" type="range" min="0" max={sorted.length} step="1" value={cursor} aria-label="时间轴" onChange={e=>setReplay(r=>({...r,cursor:+e.target.value}))}/><span className="replay-end">现在</span><div className="replay-side"><label className="operator">操作人<input value={operator} onChange={e=>setOperator(e.target.value)}/></label><button onClick={()=>setReplay(r=>({...r,cursor:sorted.length}))} disabled={!viewingPast}>回到现在</button><button onClick={()=>setShowHistory(s=>!s)}>记录 {sorted.length}</button></div></footer>
  {showHistory&&<div className="history-drawer"><div className="history-head"><span>变更记录</span><small>{sorted.length} 条 · 点击行回到该时刻 · 同一时刻按提交顺序应用</small></div>{sorted.length===0&&<p className="history-empty">还没有变更记录</p>}{sorted.map((r,i)=>({r,i})).reverse().map(({r,i})=><div className={'history-row'+(i>=cursor?' future':'')+(problemId===r.id?' problem':'')} key={r.id} onClick={()=>setReplay(p=>({...p,cursor:i+1}))}><span className="seq">#{r.seq}</span><span className="time">{fmtTime(r.ts)}</span><span className="op">{r.op}</span><span className="desc">{describe(r)}</span><button onClick={e=>{e.stopPropagation();revoke(r.id)}}>撤回</button></div>)}</div>}
  {notice&&<div className="toast">{notice}</div>}</div>
}
createRoot(document.getElementById('root')).render(<App/>);
