var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var GameDO = class {
  static {
    __name(this, "GameDO");
  }
  constructor(state) {
    this.state = state;
  }
  emptyGame() {
    return {
      gameId: crypto.randomUUID(),
      startedAt: Date.now(),
      players: {},
      // id -> {id, name, removed}
      rounds: {}
      // id -> {id, playerId, score, n, m, x2, bust, voided, ts}
    };
  }
  async getGame() {
    return await this.state.storage.get("game") || this.emptyGame();
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/api/state") {
      return Response.json(await this.getGame());
    }
    if (request.method === "POST" && url.pathname === "/api/op") {
      let op;
      try {
        op = await request.json();
      } catch {
        return new Response("bad json", { status: 400 });
      }
      const game = await this.getGame();
      const err = this.apply(game, op);
      if (err) return new Response(err, { status: 400 });
      await this.state.storage.put("game", game);
      return Response.json(game);
    }
    return new Response("not found", { status: 404 });
  }
  apply(game, op) {
    switch (op.type) {
      case "addPlayer": {
        const name = String(op.name || "").trim().slice(0, 30);
        if (!name) return "name required";
        const id = crypto.randomUUID();
        game.players[id] = { id, name };
        return null;
      }
      case "removePlayer": {
        const p = game.players[op.playerId];
        if (!p) return "no such player";
        p.removed = true;
        return null;
      }
      case "addRound": {
        if (!game.players[op.playerId]) return "no such player";
        const bust = !!op.bust;
        const n = bust ? [] : uniqInts(op.n, 0, 12).slice(0, 7);
        const m = bust ? [] : uniqInts(op.m, 2, 10).filter((v) => [2, 4, 6, 8, 10].includes(v));
        const x2 = bust ? false : !!op.x2;
        let base = n.reduce((s, v) => s + v, 0);
        if (x2) base *= 2;
        const score = bust ? 0 : base + m.reduce((s, v) => s + v, 0) + (n.length === 7 ? 15 : 0);
        const id = crypto.randomUUID();
        game.rounds[id] = { id, playerId: op.playerId, score, n, m, x2, bust, ts: Date.now() };
        return null;
      }
      case "voidRound": {
        const r = game.rounds[op.roundId];
        if (!r) return "no such round";
        r.voided = true;
        return null;
      }
      case "reset": {
        const fresh = this.emptyGame();
        for (const [id, p] of Object.entries(game.players)) {
          if (!p.removed) fresh.players[id] = { id, name: p.name };
        }
        game.gameId = fresh.gameId;
        game.startedAt = fresh.startedAt;
        game.players = fresh.players;
        game.rounds = {};
        return null;
      }
      default:
        return "unknown op";
    }
  }
};
function uniqInts(arr, min, max) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= min && v <= max))];
}
__name(uniqInts, "uniqInts");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const id = env.GAME.idFromName("global");
      return env.GAME.get(id).fetch(request);
    }
    return new Response(HTML, { headers: { "content-type": "text/html;charset=utf-8" } });
  }
};
var HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flip 7 \u2014 score tracker</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Titan+One&family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --ink:#0F1B30; --panel:#1B2A4A; --panel2:#243A63; --paper:#F7F2E8; --paperdim:#D9D2C2;
    --coral:#FF6459; --sun:#FFC53D; --mint:#45D9AE; --text:#E8EDF7; --dim:#8FA0BF;
  }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; background:var(--ink); color:var(--text);
    font-family:'Outfit',system-ui,sans-serif; padding:20px 14px 48px; }
  .wrap { max-width:460px; margin:0 auto; }
  h1 { font-family:'Titan One',system-ui,sans-serif; font-size:44px; margin:0; text-align:center; letter-spacing:1px; }
  h1 .a { color:var(--sun); } h1 .b { color:var(--coral); }
  .sub { text-align:center; color:var(--dim); font-size:14px; margin:2px 0 18px; }
  button { font-family:inherit; cursor:pointer; }
  button:focus-visible, input:focus-visible { outline:2px solid var(--sun); outline-offset:2px; }
  .winner { background:var(--sun); color:var(--ink); border-radius:12px; padding:12px 16px;
    margin-bottom:16px; text-align:center; font-weight:700; animation:pop .4s ease; }
  .board { display:flex; flex-direction:column; gap:10px; margin-bottom:18px; }
  .pcard { background:var(--panel); border-radius:12px; padding:12px 14px; }
  .prow { display:flex; align-items:baseline; gap:10px; }
  .rank { font-family:'Titan One'; font-size:16px; color:var(--dim); width:22px; }
  .rank.lead { color:var(--sun); }
  .pname { font-weight:700; font-size:17px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .last { font-size:12px; color:var(--dim); } .last.bust { color:var(--coral); }
  .total { font-family:'Titan One'; font-size:26px; color:var(--paper); }
  .barbg { height:6px; border-radius:3px; background:rgba(255,255,255,.08); overflow:hidden; margin:8px 0 10px; }
  .bar { height:100%; border-radius:3px; background:var(--mint); transition:width .3s ease; }
  .bar.won { background:var(--sun); }
  .btnrow { display:flex; gap:8px; }
  .btn { border:none; border-radius:8px; font-weight:700; font-size:14px; padding:8px 0; }
  .btn.mint { background:var(--mint); color:var(--ink); flex:1; }
  .btn.ghost { background:transparent; color:var(--dim); border:1px solid rgba(255,255,255,.15); padding:0 12px; font-size:13px; font-weight:400; }
  .addrow { display:flex; gap:8px; margin-bottom:22px; }
  .addrow input { flex:1; background:var(--panel); border:1px solid rgba(255,255,255,.15); border-radius:8px;
    color:var(--text); padding:10px 12px; font-size:15px; font-family:inherit; }
  .addrow input::placeholder { color:var(--dim); }
  .addrow button { background:var(--sun); color:var(--ink); border:none; border-radius:8px; padding:0 18px; font-weight:700; font-size:14px; }
  .entry { background:var(--panel); border-radius:14px; padding:16px; margin-bottom:22px; }
  .entry h2 { font-family:'Titan One'; font-size:18px; margin:0; }
  .ehead { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px; }
  .cancel { background:none; border:none; color:var(--dim); font-size:14px; }
  .hint { margin:0 0 6px; font-size:13px; color:var(--dim); }
  .cards { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
  .mini { font-family:'Titan One'; font-size:19px; line-height:1; width:44px; height:58px; border-radius:8px;
    border:2px solid rgba(255,255,255,.14); background:var(--panel2); color:var(--paperdim);
    box-shadow:0 2px 0 rgba(0,0,0,.25); transition:transform .12s, background .12s, color .12s; }
  .mini.wide { width:62px; font-size:15px; }
  .mini.on { color:var(--ink); transform:translateY(-2px); box-shadow:0 3px 0 rgba(0,0,0,.35); }
  .mini.on.num { background:var(--paper); border-color:var(--paper); }
  .mini.on.mod { background:var(--mint); border-color:var(--mint); }
  .mini.on.x2 { background:var(--sun); border-color:var(--sun); }
  .mini:disabled { opacity:.35; cursor:default; }
  .flip7 { background:var(--coral); color:var(--ink); border-radius:8px; padding:8px 12px; font-weight:700;
    text-align:center; margin-bottom:12px; animation:pop .35s ease; }
  .live { display:flex; justify-content:space-between; align-items:center; background:var(--panel2);
    border-radius:10px; padding:10px 14px; margin-bottom:12px; }
  .live .lbl { font-size:13px; color:var(--dim); }
  .live .val { font-family:'Titan One'; font-size:30px; color:var(--sun); }
  .save { flex:2; background:var(--mint); color:var(--ink); border:none; border-radius:8px; padding:12px 0; font-weight:700; font-size:15px; }
  .bust { flex:1; background:var(--coral); color:var(--ink); border:none; border-radius:8px; padding:12px 0; font-weight:700; font-size:15px; }
  .histbtn { background:none; border:none; color:var(--dim); font-size:14px; padding:0; }
  .hist { margin-top:10px; display:flex; flex-direction:column; gap:6px; }
  .hrow { display:flex; align-items:center; gap:10px; background:var(--panel); border-radius:8px; padding:8px 12px; font-size:14px; }
  .hrow .n { flex:1; } .hrow .s { font-weight:700; color:var(--mint); } .hrow .s.b { color:var(--coral); }
  .hrow .undo { background:none; border:none; color:var(--dim); font-size:13px; }
  .foot { text-align:center; margin-top:26px; }
  .reset { background:none; border:1px solid rgba(255,255,255,.2); color:var(--dim); border-radius:8px; padding:8px 16px; font-size:14px; }
  .reset.danger { background:var(--coral); color:var(--ink); border:none; font-weight:700; }
  .note { font-size:12px; color:var(--dim); margin-top:18px; }
  .empty { color:var(--dim); text-align:center; margin:24px 0; }
  .sync { color:var(--dim); }
  @keyframes pop { 0%{transform:scale(.85)} 60%{transform:scale(1.06)} 100%{transform:scale(1)} }
  @media (prefers-reduced-motion:reduce){ *{transition:none!important;animation:none!important} }
</style>
</head>
<body>
<div class="wrap">
  <h1><span class="a">FLIP</span> <span class="b">7</span></h1>
  <p class="sub">Score tracker \xB7 first to 200 wins <span id="sync" class="sync"></span></p>
  <div id="app"><p class="empty">Loading scores\u2026</p></div>
</div>
<script>
const TARGET = 200;
const MODS = [2,4,6,8,10];
let game = null;
let entry = null; // {playerId, n:[], m:[], x2}
let showHist = false;
let confirmReset = false;

const $app = document.getElementById('app');
const $sync = document.getElementById('sync');

function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function computeScore(n,m,x2){ let b=n.reduce((s,v)=>s+v,0); if(x2)b*=2; return b+m.reduce((s,v)=>s+v,0)+(n.length===7?15:0); }

async function refresh(){
  try{
    const r = await fetch('/api/state');
    if(r.ok){ game = await r.json(); render(); }
  }catch(e){}
}
async function op(o){
  $sync.textContent = '\xB7 syncing\u2026';
  try{
    const r = await fetch('/api/op',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)});
    if(r.ok){ game = await r.json(); render(); }
  }catch(e){}
  $sync.textContent = '';
}

function render(){
  if(!game){ return; }
  const players = Object.values(game.players).filter(p=>!p.removed);
  const rounds = Object.values(game.rounds).filter(r=>!r.voided);
  const totals = {}, last = {};
  for(const r of rounds){
    totals[r.playerId]=(totals[r.playerId]||0)+r.score;
    if(!last[r.playerId]||r.ts>last[r.playerId].ts) last[r.playerId]=r;
  }
  const ranked=[...players].sort((a,b)=>(totals[b.id]||0)-(totals[a.id]||0));
  const winner=ranked.find(p=>(totals[p.id]||0)>=TARGET);
  let h='';
  if(winner) h+='<div class="winner">\\uD83C\\uDFC6 '+esc(winner.name)+' wins with '+totals[winner.id]+' points!</div>';
  h+='<div class="board">';
  if(!ranked.length) h+='<p class="empty">No players yet \u2014 add everyone at the table below.</p>';
  ranked.forEach((p,i)=>{
    const t=totals[p.id]||0, lr=last[p.id];
    h+='<div class="pcard"><div class="prow">'
      +'<span class="rank'+(i===0&&t>0?' lead':'')+'">'+(i+1)+'</span>'
      +'<span class="pname">'+esc(p.name)+'</span>'
      +(lr?'<span class="last'+(lr.bust?' bust':'')+'">'+(lr.bust?'busted':'+'+lr.score)+(lr.n&&lr.n.length===7?' \xB7 FLIP 7!':'')+'</span>':'')
      +'<span class="total">'+t+'</span></div>'
      +'<div class="barbg"><div class="bar'+(t>=TARGET?' won':'')+'" style="width:'+Math.min(100,t/TARGET*100)+'%"></div></div>'
      +'<div class="btnrow">'
      +'<button class="btn mint" data-score="'+p.id+'">Score round</button>'
      +'<button class="btn ghost" data-remove="'+p.id+'" aria-label="Remove '+esc(p.name)+'">Remove</button>'
      +'</div></div>';
  });
  h+='</div>';
  h+='<div class="addrow"><input id="pname" placeholder="Player name" maxlength="30">'
    +'<button id="padd">Add player</button></div>';
  if(entry && game.players[entry.playerId]){
    const pl=game.players[entry.playerId];
    const live=computeScore(entry.n,entry.m,entry.x2);
    h+='<div class="entry"><div class="ehead"><h2>'+esc(pl.name)+"'s round</h2>"
      +'<button class="cancel" id="ecancel">Cancel</button></div>'
      +'<p class="hint">Tap the number cards they kept</p><div class="cards">';
    for(let n=0;n<=12;n++){
      const on=entry.n.includes(n);
      h+='<button class="mini num'+(on?' on num':'')+'" data-num="'+n+'"'+(!on&&entry.n.length>=7?' disabled':'')+'>'+n+'</button>';
    }
    h+='</div><p class="hint">Modifier cards</p><div class="cards">';
    for(const m of MODS){
      h+='<button class="mini wide mod'+(entry.m.includes(m)?' on mod':'')+'" data-mod="'+m+'">+'+m+'</button>';
    }
    h+='<button class="mini wide x2'+(entry.x2?' on x2':'')+'" data-x2>\\u00D72</button></div>';
    if(entry.n.length===7) h+='<div class="flip7">FLIP 7! +15 bonus</div>';
    h+='<div class="live"><span class="lbl">'+(entry.x2?'numbers \\u00D72 + modifiers':'numbers + modifiers')+(entry.n.length===7?' + 15':'')+'</span>'
      +'<span class="val">'+live+'</span></div>'
      +'<div class="btnrow"><button class="save" id="esave">Bank '+live+' points</button>'
      +'<button class="bust" id="ebust">Busted</button></div></div>';
  }
  h+='<button class="histbtn" id="histbtn">'+(showHist?'\\u25BE Hide round history':'\\u25B8 Show round history')+'</button>';
  if(showHist){
    h+='<div class="hist">';
    const rs=[...rounds].sort((a,b)=>b.ts-a.ts).slice(0,30);
    if(!rs.length) h+='<p class="empty" style="margin:8px 0">No rounds scored yet.</p>';
    for(const r of rs){
      h+='<div class="hrow"><span class="n">'+esc((game.players[r.playerId]||{}).name||'?')+'</span>'
        +'<span class="s'+(r.bust?' b':'')+'">'+(r.bust?'bust':'+'+r.score)+'</span>'
        +'<button class="undo" data-void="'+r.id+'" aria-label="Void this round">undo</button></div>';
    }
    h+='</div>';
  }
  h+='<div class="foot">';
  if(confirmReset){
    h+='<span class="hint" style="margin-right:8px">Clear all scores?</span>'
      +'<button class="reset danger" id="doreset">Yes, new game</button> '
      +'<button class="reset" id="noreset">Keep playing</button>';
  } else {
    h+='<button class="reset" id="askreset">New game (keeps players)</button>';
  }
  h+='<p class="note">Scores are shared: everyone with this link sees and edits the same scoreboard. It refreshes every few seconds.</p></div>';
  $app.innerHTML=h;
  bind();
}

function bind(){
  const q=(s)=>$app.querySelector(s);
  $app.querySelectorAll('[data-score]').forEach(b=>b.onclick=()=>{entry={playerId:b.dataset.score,n:[],m:[],x2:false};render();});
  $app.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>op({type:'removePlayer',playerId:b.dataset.remove}));
  $app.querySelectorAll('[data-void]').forEach(b=>b.onclick=()=>op({type:'voidRound',roundId:b.dataset.void}));
  $app.querySelectorAll('[data-num]').forEach(b=>b.onclick=()=>{
    const n=+b.dataset.num;
    entry.n=entry.n.includes(n)?entry.n.filter(v=>v!==n):[...entry.n,n];
    render();
  });
  $app.querySelectorAll('[data-mod]').forEach(b=>b.onclick=()=>{
    const m=+b.dataset.mod;
    entry.m=entry.m.includes(m)?entry.m.filter(v=>v!==m):[...entry.m,m];
    render();
  });
  const x2b=q('[data-x2]'); if(x2b) x2b.onclick=()=>{entry.x2=!entry.x2;render();};
  const pi=q('#pname'), pa=q('#padd');
  if(pa) pa.onclick=()=>{ if(pi.value.trim()){ op({type:'addPlayer',name:pi.value}); pi.value=''; } };
  if(pi) pi.onkeydown=(e)=>{ if(e.key==='Enter') pa.onclick(); };
  const ec=q('#ecancel'); if(ec) ec.onclick=()=>{entry=null;render();};
  const es=q('#esave'); if(es) es.onclick=()=>{const e2=entry;entry=null;op({type:'addRound',playerId:e2.playerId,n:e2.n,m:e2.m,x2:e2.x2,bust:false});};
  const eb=q('#ebust'); if(eb) eb.onclick=()=>{const e2=entry;entry=null;op({type:'addRound',playerId:e2.playerId,bust:true});};
  const hb=q('#histbtn'); if(hb) hb.onclick=()=>{showHist=!showHist;render();};
  const ar=q('#askreset'); if(ar) ar.onclick=()=>{confirmReset=true;render();};
  const nr=q('#noreset'); if(nr) nr.onclick=()=>{confirmReset=false;render();};
  const dr=q('#doreset'); if(dr) dr.onclick=()=>{confirmReset=false;op({type:'reset'});};
}

refresh();
setInterval(()=>{ if(!entry) refresh(); }, 4000);
<\/script>
</body>
</html>`;
export {
  GameDO,
  index_default as default
};
//# sourceMappingURL=index.js.map
