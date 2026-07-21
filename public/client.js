import { TARGET, MODS, computeScore } from '/scoring.js';

const ROOM = ((location.pathname.match(/^\/g\/([A-Za-z0-9]{4,8})\/?$/) || [])[1] || '').toUpperCase() || null;
const API = ROOM ? '/api/g/' + ROOM : null;

let game = null;
let entry = null; // {playerId, n:[], m:[], x2}
let showHist = false;
let confirmReset = false;
let announcedWinner = null; // id of winner we've already animated

const $app = document.getElementById('app');
const $sync = document.getElementById('sync');

// --- helpers ---------------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ESCAPES[c]);
}

function newCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  const buf = crypto.getRandomValues(new Uint8Array(5));
  return [...buf].map(b => alphabet[b % alphabet.length]).join('');
}

// --- networking ------------------------------------------------------------

let ws = null;
let wsDelay = 1000;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(proto + '://' + location.host + API + '/ws');
  ws.onopen = () => {
    wsDelay = 1000;
    $sync.textContent = '';
  };
  ws.onmessage = (e) => {
    if (e.data === 'pong') return;
    game = JSON.parse(e.data);
    render();
  };
  ws.onclose = () => {
    $sync.textContent = '· reconnecting…';
    setTimeout(connect, wsDelay);
    wsDelay = Math.min(wsDelay * 2, 15000);
  };
  ws.onerror = () => ws.close();
}

async function refresh() {
  try {
    const r = await fetch(API + '/state');
    if (r.ok) {
      game = await r.json();
      render();
    }
  } catch (e) { /* ignore transient network errors */ }
}

async function op(o) {
  $sync.textContent = '· syncing…';
  try {
    const r = await fetch(API + '/op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(o),
    });
    if (r.ok) {
      game = await r.json();
      render();
    }
  } catch (e) { /* ignore transient network errors */ }
  $sync.textContent = ws && ws.readyState === WebSocket.OPEN ? '' : '· reconnecting…';
}

// --- rendering -------------------------------------------------------------

function renderLanding() {
  $app.innerHTML = `
    <div class="landing">
      <p class="empty">Start a game and share the link — everyone at the table sees and edits the same scoreboard, live.</p>
      <button class="save" id="newgame">Start a new game</button>
      <p class="or">or join an existing one</p>
      <div class="addrow">
        <input id="joincode" placeholder="Game code" maxlength="8" autocapitalize="characters" autocomplete="off">
        <button id="joinbtn">Join</button>
      </div>
    </div>`;
}

function render() {
  if (!game) return;

  // Preserve the add-player input across re-renders (remote updates included).
  const pi0 = document.getElementById('pname');
  const nameVal = pi0 ? pi0.value : '';
  const nameFocus = pi0 && document.activeElement === pi0
    ? { start: pi0.selectionStart, end: pi0.selectionEnd } : null;

  const players = Object.values(game.players).filter(p => !p.removed);
  const rounds = Object.values(game.rounds).filter(r => !r.voided);

  // Tally each player's total and remember their most recent round.
  const totals = {};
  const last = {};
  for (const r of rounds) {
    totals[r.playerId] = (totals[r.playerId] || 0) + r.score;
    if (!last[r.playerId] || r.ts > last[r.playerId].ts) last[r.playerId] = r;
  }

  const ranked = [...players].sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0));
  const winner = ranked.find(p => (totals[p.id] || 0) >= TARGET);

  let h = `<div class="roomtag">Game code <b>${ROOM}</b><button id="copylink">Copy link</button></div>`;

  // Winner banner (animate once, the first time we see this winner).
  if (winner) {
    const fresh = announcedWinner !== winner.id;
    announcedWinner = winner.id;
    h += `<div class="winner${fresh ? ' anim' : ''}">🏆 ${esc(winner.name)} wins with ${totals[winner.id]} points!</div>`;
  } else {
    announcedWinner = null;
  }

  // Scoreboard.
  h += `
    <div class="board">
      ${ranked.length ? '' : '<p class="empty">No players yet — add everyone at the table below.</p>'}
      ${ranked.map((p, i) => renderCard(p, i, totals[p.id] || 0, last[p.id])).join('')}
    </div>
    <div class="addrow">
      <input id="pname" placeholder="Player name" maxlength="30" value="${esc(nameVal)}">
      <button id="padd">Add player</button>
    </div>`;

  // Round entry panel for the currently selected player.
  if (entry && game.players[entry.playerId]) {
    h += renderEntry(game.players[entry.playerId]);
  }

  // Round history toggle + list.
  h += `<button class="histbtn" id="histbtn">${showHist ? '▾ Hide round history' : '▸ Show round history'}</button>`;
  if (showHist) {
    h += renderHistory(rounds);
  }

  // Footer: new-game controls + shared-scoreboard note.
  h += `
    <div class="foot">
      ${confirmReset
        ? `<span class="hint" style="margin-right:8px">Clear all scores?</span>
           <button class="reset danger" id="doreset">Yes, new game</button>
           <button class="reset" id="noreset">Keep playing</button>`
        : '<button class="reset" id="askreset">New game (keeps players)</button>'}
      <p class="note">Scores are shared: everyone with this link sees and edits the same scoreboard, live.</p>
    </div>`;

  $app.innerHTML = h;

  if (nameFocus) {
    const pi = document.getElementById('pname');
    pi.focus();
    pi.setSelectionRange(nameFocus.start, nameFocus.end);
  }
}

function renderCard(p, rank, total, lastRound) {
  const isLead = rank === 0 && total > 0;
  const barWidth = Math.min(100, (total / TARGET) * 100);

  let lastLabel = '';
  if (lastRound) {
    const text = lastRound.bust ? 'busted' : '+' + lastRound.score;
    const flip7 = lastRound.n && lastRound.n.length === 7 ? ' · FLIP 7!' : '';
    lastLabel = `<span class="last${lastRound.bust ? ' busted' : ''}">${text}${flip7}</span>`;
  }

  return `
    <div class="pcard">
      <div class="prow">
        <span class="rank${isLead ? ' lead' : ''}">${rank + 1}</span>
        <span class="pname">${esc(p.name)}</span>
        ${lastLabel}
        <span class="total">${total}</span>
      </div>
      <div class="barbg"><div class="bar${total >= TARGET ? ' won' : ''}" style="width:${barWidth}%"></div></div>
      <div class="btnrow">
        <button class="btn mint" data-score="${p.id}">Score round</button>
        <button class="btn ghost" data-remove="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button>
      </div>
    </div>`;
}

function renderEntry(pl) {
  const live = computeScore(entry.n, entry.m, entry.x2);

  const numBtns = Array.from({ length: 13 }, (_, n) => {
    const on = entry.n.includes(n);
    const disabled = !on && entry.n.length >= 7 ? ' disabled' : '';
    return `<button class="mini num${on ? ' on num' : ''}" data-num="${n}"${disabled}>${n}</button>`;
  }).join('');

  const modBtns = MODS.map((m) =>
    `<button class="mini wide mod${entry.m.includes(m) ? ' on mod' : ''}" data-mod="${m}">+${m}</button>`,
  ).join('');

  const formula = (entry.x2 ? 'numbers ×2 + modifiers' : 'numbers + modifiers')
    + (entry.n.length === 7 ? ' + 15' : '');

  return `
    <div class="entry">
      <div class="ehead">
        <h2>${esc(pl.name)}'s round</h2>
        <button class="cancel" id="ecancel">Cancel</button>
      </div>
      <p class="hint">Tap the number cards they kept</p>
      <div class="cards">${numBtns}</div>
      <p class="hint">Modifier cards</p>
      <div class="cards">
        ${modBtns}
        <button class="mini wide x2${entry.x2 ? ' on x2' : ''}" data-x2>×2</button>
      </div>
      ${entry.n.length === 7 ? '<div class="flip7">FLIP 7! +15 bonus</div>' : ''}
      <div class="live"><span class="lbl">${formula}</span><span class="val">${live}</span></div>
      <div class="btnrow">
        <button class="save" id="esave">Bank ${live} points</button>
        <button class="bust" id="ebust">Busted</button>
      </div>
    </div>`;
}

function renderHistory(rounds) {
  const recent = [...rounds].sort((a, b) => b.ts - a.ts).slice(0, 30);

  if (!recent.length) {
    return '<div class="hist"><p class="empty" style="margin:8px 0">No rounds scored yet.</p></div>';
  }

  const rows = recent.map((r) => {
    const name = esc((game.players[r.playerId] || {}).name || '?');
    const score = r.bust ? 'bust' : '+' + r.score;
    return `
      <div class="hrow">
        <span class="n">${name}</span>
        <span class="s${r.bust ? ' b' : ''}">${score}</span>
        <button class="undo" data-void="${r.id}" aria-label="Void this round">undo</button>
      </div>`;
  }).join('');

  return `<div class="hist">${rows}</div>`;
}

// --- event wiring (single delegated listener, attached once) ---------------

function addPlayerFromInput() {
  const pi = document.getElementById('pname');
  if (pi && pi.value.trim()) {
    op({ type: 'addPlayer', name: pi.value });
    pi.value = '';
  }
}

function joinFromInput() {
  const v = document.getElementById('joincode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (v.length >= 4) location.href = '/g/' + v;
}

$app.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;

  if (d.score) {
    entry = { playerId: d.score, n: [], m: [], x2: false };
    render();
  } else if (d.remove) {
    op({ type: 'removePlayer', playerId: d.remove });
  } else if (d.void) {
    op({ type: 'voidRound', roundId: d.void });
  } else if (d.num !== undefined) {
    const n = +d.num;
    entry.n = entry.n.includes(n) ? entry.n.filter(v => v !== n) : [...entry.n, n];
    render();
  } else if (d.mod !== undefined) {
    const m = +d.mod;
    entry.m = entry.m.includes(m) ? entry.m.filter(v => v !== m) : [...entry.m, m];
    render();
  } else if ('x2' in d) {
    entry.x2 = !entry.x2;
    render();
  } else {
    switch (b.id) {
      case 'padd':
        addPlayerFromInput();
        break;
      case 'ecancel':
        entry = null;
        render();
        break;
      case 'esave': {
        const e2 = entry;
        entry = null;
        op({ type: 'addRound', playerId: e2.playerId, n: e2.n, m: e2.m, x2: e2.x2, bust: false });
        break;
      }
      case 'ebust': {
        const e2 = entry;
        entry = null;
        op({ type: 'addRound', playerId: e2.playerId, bust: true });
        break;
      }
      case 'histbtn':
        showHist = !showHist;
        render();
        break;
      case 'askreset':
        confirmReset = true;
        render();
        break;
      case 'noreset':
        confirmReset = false;
        render();
        break;
      case 'doreset':
        confirmReset = false;
        op({ type: 'reset' });
        break;
      case 'copylink':
        navigator.clipboard.writeText(location.origin + '/g/' + ROOM).then(() => {
          b.textContent = 'Copied!';
          setTimeout(() => { b.textContent = 'Copy link'; }, 1500);
        }).catch(() => {});
        break;
      case 'newgame':
        location.href = '/g/' + newCode();
        break;
      case 'joinbtn':
        joinFromInput();
        break;
    }
  }
});

$app.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'pname') addPlayerFromInput();
  else if (e.target.id === 'joincode') joinFromInput();
});

// --- boot ------------------------------------------------------------------

if (!ROOM) {
  renderLanding();
} else {
  refresh(); // fast first paint; the socket takes over from here
  connect();

  // Keepalive: the DO answers without waking from hibernation.
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send('ping');
  }, 30000);

  // Coming back to the tab: make sure we're current even if the socket dropped.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}
