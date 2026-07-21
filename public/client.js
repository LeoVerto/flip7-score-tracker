const TARGET = 200;
const MODS = [2, 4, 6, 8, 10];

// Single source of truth. `game` is server state; the rest is local UI state.
const state = {
  game: null,
  entry: null,          // {playerId, n:[], m:[], x2} while scoring a round
  showHist: false,
  confirmReset: false,
  announcedWinner: null, // id of the winner we've already animated
};

const $app = document.getElementById('app');
const $sync = document.getElementById('sync');

// --- helpers ---------------------------------------------------------------

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ESCAPES[c]);
}

function computeScore(n, m, x2) {
  let base = n.reduce((sum, v) => sum + v, 0);
  if (x2) base *= 2;
  const modifiers = m.reduce((sum, v) => sum + v, 0);
  const flip7Bonus = n.length === 7 ? 15 : 0;
  return base + modifiers + flip7Bonus;
}

function setState(patch) {
  Object.assign(state, patch);
  render();
}

// --- networking ------------------------------------------------------------

async function refresh() {
  try {
    const r = await fetch('/api/state');
    if (r.ok) setState({ game: await r.json() });
  } catch (e) { /* ignore transient network errors */ }
}

async function op(o) {
  $sync.textContent = '· syncing…';
  try {
    const r = await fetch('/api/op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(o),
    });
    if (r.ok) setState({ game: await r.json() });
  } catch (e) { /* ignore transient network errors */ }
  $sync.textContent = '';
}

// --- rendering -------------------------------------------------------------

function render() {
  if (!state.game) return;

  const { game } = state;
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
  const activePlayer = state.entry && game.players[state.entry.playerId];

  $app.innerHTML = [
    winnerBanner(winner, totals),
    scoreboard(ranked, totals, last),
    addRow(),
    activePlayer ? entryPanel(activePlayer) : '',
    historySection(rounds),
    footer(),
  ].join('');
}

function winnerBanner(winner, totals) {
  if (!winner) {
    state.announcedWinner = null;
    return '';
  }
  // Animate only the first time we see this particular winner.
  const fresh = state.announcedWinner !== winner.id;
  state.announcedWinner = winner.id;
  return `<div class="winner${fresh ? ' anim' : ''}">🏆 ${esc(winner.name)} wins with ${totals[winner.id]} points!</div>`;
}

function scoreboard(ranked, totals, last) {
  if (!ranked.length) {
    return '<div class="board"><p class="empty">No players yet — add everyone at the table below.</p></div>';
  }
  return `<div class="board">${ranked.map((p, i) => playerCard(p, i, totals, last)).join('')}</div>`;
}

function playerCard(p, i, totals, last) {
  const t = totals[p.id] || 0;
  const lr = last[p.id];
  const isLead = i === 0 && t > 0;
  const barWidth = Math.min(100, (t / TARGET) * 100);

  let lastLabel = '';
  if (lr) {
    const text = lr.bust ? 'busted' : '+' + lr.score;
    const flip7 = lr.n && lr.n.length === 7 ? ' · FLIP 7!' : '';
    lastLabel = `<span class="last${lr.bust ? ' busted' : ''}">${text}${flip7}</span>`;
  }

  return `
    <div class="pcard">
      <div class="prow">
        <span class="rank${isLead ? ' lead' : ''}">${i + 1}</span>
        <span class="pname">${esc(p.name)}</span>
        ${lastLabel}
        <span class="total">${t}</span>
      </div>
      <div class="barbg"><div class="bar${t >= TARGET ? ' won' : ''}" style="width:${barWidth}%"></div></div>
      <div class="btnrow">
        <button class="btn mint" data-action="openEntry" data-id="${p.id}">Score round</button>
        <button class="btn ghost" data-action="removePlayer" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button>
      </div>
    </div>`;
}

function addRow() {
  return `
    <div class="addrow">
      <input id="pname" placeholder="Player name" maxlength="30">
      <button data-action="addPlayer">Add player</button>
    </div>`;
}

function entryPanel(pl) {
  const { n, m, x2 } = state.entry;
  const live = computeScore(n, m, x2);

  const numCards = Array.from({ length: 13 }, (_, k) => {
    const on = n.includes(k);
    const disabled = !on && n.length >= 7 ? ' disabled' : '';
    return `<button class="mini num${on ? ' on num' : ''}" data-action="toggleNum" data-value="${k}"${disabled}>${k}</button>`;
  }).join('');

  const modCards = MODS.map(mod =>
    `<button class="mini wide mod${m.includes(mod) ? ' on mod' : ''}" data-action="toggleMod" data-value="${mod}">+${mod}</button>`
  ).join('');

  const formula = (x2 ? 'numbers ×2 + modifiers' : 'numbers + modifiers') + (n.length === 7 ? ' + 15' : '');

  return `
    <div class="entry">
      <div class="ehead"><h2>${esc(pl.name)}'s round</h2><button class="cancel" data-action="cancelEntry">Cancel</button></div>
      <p class="hint">Tap the number cards they kept</p>
      <div class="cards">${numCards}</div>
      <p class="hint">Modifier cards</p>
      <div class="cards">${modCards}<button class="mini wide x2${x2 ? ' on x2' : ''}" data-action="toggleX2">×2</button></div>
      ${n.length === 7 ? '<div class="flip7">FLIP 7! +15 bonus</div>' : ''}
      <div class="live"><span class="lbl">${formula}</span><span class="val">${live}</span></div>
      <div class="btnrow"><button class="save" data-action="saveEntry">Bank ${live} points</button><button class="bust" data-action="bustEntry">Busted</button></div>
    </div>`;
}

function historySection(rounds) {
  const toggle = `<button class="histbtn" data-action="toggleHist">${state.showHist ? '▾ Hide round history' : '▸ Show round history'}</button>`;
  if (!state.showHist) return toggle;

  const recent = [...rounds].sort((a, b) => b.ts - a.ts).slice(0, 30);
  if (!recent.length) {
    return toggle + '<div class="hist"><p class="empty" style="margin:8px 0">No rounds scored yet.</p></div>';
  }

  const rows = recent.map(r => {
    const name = esc((state.game.players[r.playerId] || {}).name || '?');
    const score = r.bust ? 'bust' : '+' + r.score;
    return `<div class="hrow"><span class="n">${name}</span><span class="s${r.bust ? ' b' : ''}">${score}</span><button class="undo" data-action="voidRound" data-id="${r.id}" aria-label="Void this round">undo</button></div>`;
  }).join('');

  return toggle + `<div class="hist">${rows}</div>`;
}

function footer() {
  const controls = state.confirmReset
    ? '<span class="hint" style="margin-right:8px">Clear all scores?</span>'
      + '<button class="reset danger" data-action="doReset">Yes, new game</button> '
      + '<button class="reset" data-action="cancelReset">Keep playing</button>'
    : '<button class="reset" data-action="askReset">New game (keeps players)</button>';

  return '<div class="foot">' + controls
    + '<p class="note">Scores are shared: everyone with this link sees and edits the same '
    + 'scoreboard. It refreshes every few seconds.</p></div>';
}

// --- event wiring (delegated: bound once, survives re-renders) --------------

const actions = {
  openEntry(el) {
    setState({ entry: { playerId: el.dataset.id, n: [], m: [], x2: false } });
  },
  removePlayer(el) {
    op({ type: 'removePlayer', playerId: el.dataset.id });
  },
  voidRound(el) {
    op({ type: 'voidRound', roundId: el.dataset.id });
  },
  toggleNum(el) {
    const n = +el.dataset.value;
    const { entry } = state;
    entry.n = entry.n.includes(n) ? entry.n.filter(v => v !== n) : [...entry.n, n];
    render();
  },
  toggleMod(el) {
    const m = +el.dataset.value;
    const { entry } = state;
    entry.m = entry.m.includes(m) ? entry.m.filter(v => v !== m) : [...entry.m, m];
    render();
  },
  toggleX2() {
    state.entry.x2 = !state.entry.x2;
    render();
  },
  addPlayer() {
    const input = $app.querySelector('#pname');
    if (input.value.trim()) {
      op({ type: 'addPlayer', name: input.value });
      input.value = '';
    }
  },
  cancelEntry() {
    setState({ entry: null });
  },
  saveEntry() {
    const { entry } = state;
    state.entry = null;
    op({ type: 'addRound', playerId: entry.playerId, n: entry.n, m: entry.m, x2: entry.x2, bust: false });
  },
  bustEntry() {
    const { entry } = state;
    state.entry = null;
    op({ type: 'addRound', playerId: entry.playerId, bust: true });
  },
  toggleHist() {
    setState({ showHist: !state.showHist });
  },
  askReset() {
    setState({ confirmReset: true });
  },
  cancelReset() {
    setState({ confirmReset: false });
  },
  doReset() {
    state.confirmReset = false;
    op({ type: 'reset' });
  },
};

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (el) actions[el.dataset.action]?.(el);
});

$app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'pname') actions.addPlayer();
});

// --- boot ------------------------------------------------------------------

refresh();

// Poll for updates, but don't clobber the page while a player is typing a name.
setInterval(() => {
  const pi = document.getElementById('pname');
  const typingName = pi && (pi === document.activeElement || pi.value.trim());
  if (!state.entry && !typingName) refresh();
}, 4000);
