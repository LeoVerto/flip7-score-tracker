const TARGET = 200;
const MODS = [2, 4, 6, 8, 10];

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

function computeScore(n, m, x2) {
  let base = n.reduce((sum, v) => sum + v, 0);
  if (x2) base *= 2;
  const modifiers = m.reduce((sum, v) => sum + v, 0);
  const flip7Bonus = n.length === 7 ? 15 : 0;
  return base + modifiers + flip7Bonus;
}

// --- networking ------------------------------------------------------------

async function refresh() {
  try {
    const r = await fetch('/api/state');
    if (r.ok) {
      game = await r.json();
      render();
    }
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
    if (r.ok) {
      game = await r.json();
      render();
    }
  } catch (e) { /* ignore transient network errors */ }
  $sync.textContent = '';
}

// --- rendering -------------------------------------------------------------

function render() {
  if (!game) return;

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

  let h = '';

  // Winner banner (animate once, the first time we see this winner).
  if (winner) {
    const fresh = announcedWinner !== winner.id;
    announcedWinner = winner.id;
    h += '<div class="winner' + (fresh ? ' anim' : '') + '">'
      + '🏆 ' + esc(winner.name) + ' wins with ' + totals[winner.id] + ' points!</div>';
  } else {
    announcedWinner = null;
  }

  // Scoreboard.
  h += '<div class="board">';
  if (!ranked.length) {
    h += '<p class="empty">No players yet — add everyone at the table below.</p>';
  }
  ranked.forEach((p, i) => {
    const t = totals[p.id] || 0;
    const lr = last[p.id];
    const isLead = i === 0 && t > 0;
    const barWidth = Math.min(100, (t / TARGET) * 100);

    let lastLabel = '';
    if (lr) {
      const text = lr.bust ? 'busted' : '+' + lr.score;
      const flip7 = lr.n && lr.n.length === 7 ? ' · FLIP 7!' : '';
      lastLabel = '<span class="last' + (lr.bust ? ' busted' : '') + '">' + text + flip7 + '</span>';
    }

    h += '<div class="pcard">'
      + '<div class="prow">'
      + '<span class="rank' + (isLead ? ' lead' : '') + '">' + (i + 1) + '</span>'
      + '<span class="pname">' + esc(p.name) + '</span>'
      + lastLabel
      + '<span class="total">' + t + '</span>'
      + '</div>'
      + '<div class="barbg"><div class="bar' + (t >= TARGET ? ' won' : '') + '" style="width:' + barWidth + '%"></div></div>'
      + '<div class="btnrow">'
      + '<button class="btn mint" data-score="' + p.id + '">Score round</button>'
      + '<button class="btn ghost" data-remove="' + p.id + '" aria-label="Remove ' + esc(p.name) + '">Remove</button>'
      + '</div>'
      + '</div>';
  });
  h += '</div>';

  // Add-player row.
  h += '<div class="addrow">'
    + '<input id="pname" placeholder="Player name" maxlength="30">'
    + '<button id="padd">Add player</button>'
    + '</div>';

  // Round entry panel for the currently selected player.
  if (entry && game.players[entry.playerId]) {
    h += renderEntry(game.players[entry.playerId]);
  }

  // Round history toggle + list.
  h += '<button class="histbtn" id="histbtn">'
    + (showHist ? '▾ Hide round history' : '▸ Show round history') + '</button>';
  if (showHist) {
    h += renderHistory(rounds);
  }

  // Footer: new-game controls + shared-scoreboard note.
  h += '<div class="foot">';
  if (confirmReset) {
    h += '<span class="hint" style="margin-right:8px">Clear all scores?</span>'
      + '<button class="reset danger" id="doreset">Yes, new game</button> '
      + '<button class="reset" id="noreset">Keep playing</button>';
  } else {
    h += '<button class="reset" id="askreset">New game (keeps players)</button>';
  }
  h += '<p class="note">Scores are shared: everyone with this link sees and edits the same '
    + 'scoreboard. It refreshes every few seconds.</p>'
    + '</div>';

  $app.innerHTML = h;
  bind();
}

function renderEntry(pl) {
  const live = computeScore(entry.n, entry.m, entry.x2);

  let h = '<div class="entry">'
    + '<div class="ehead"><h2>' + esc(pl.name) + "'s round</h2>"
    + '<button class="cancel" id="ecancel">Cancel</button></div>'
    + '<p class="hint">Tap the number cards they kept</p><div class="cards">';

  for (let n = 0; n <= 12; n++) {
    const on = entry.n.includes(n);
    const disabled = !on && entry.n.length >= 7 ? ' disabled' : '';
    h += '<button class="mini num' + (on ? ' on num' : '') + '" data-num="' + n + '"' + disabled + '>' + n + '</button>';
  }

  h += '</div><p class="hint">Modifier cards</p><div class="cards">';
  for (const m of MODS) {
    h += '<button class="mini wide mod' + (entry.m.includes(m) ? ' on mod' : '') + '" data-mod="' + m + '">+' + m + '</button>';
  }
  h += '<button class="mini wide x2' + (entry.x2 ? ' on x2' : '') + '" data-x2>×2</button></div>';

  if (entry.n.length === 7) h += '<div class="flip7">FLIP 7! +15 bonus</div>';

  const formula = (entry.x2 ? 'numbers ×2 + modifiers' : 'numbers + modifiers')
    + (entry.n.length === 7 ? ' + 15' : '');
  h += '<div class="live"><span class="lbl">' + formula + '</span>'
    + '<span class="val">' + live + '</span></div>'
    + '<div class="btnrow"><button class="save" id="esave">Bank ' + live + ' points</button>'
    + '<button class="bust" id="ebust">Busted</button></div>'
    + '</div>';

  return h;
}

function renderHistory(rounds) {
  const recent = [...rounds].sort((a, b) => b.ts - a.ts).slice(0, 30);

  let h = '<div class="hist">';
  if (!recent.length) {
    h += '<p class="empty" style="margin:8px 0">No rounds scored yet.</p>';
  }
  for (const r of recent) {
    const name = esc((game.players[r.playerId] || {}).name || '?');
    const score = r.bust ? 'bust' : '+' + r.score;
    h += '<div class="hrow"><span class="n">' + name + '</span>'
      + '<span class="s' + (r.bust ? ' b' : '') + '">' + score + '</span>'
      + '<button class="undo" data-void="' + r.id + '" aria-label="Void this round">undo</button></div>';
  }
  h += '</div>';
  return h;
}

// --- event wiring ----------------------------------------------------------

function bind() {
  const q = (s) => $app.querySelector(s);

  $app.querySelectorAll('[data-score]').forEach(b => {
    b.onclick = () => {
      entry = { playerId: b.dataset.score, n: [], m: [], x2: false };
      render();
    };
  });

  $app.querySelectorAll('[data-remove]').forEach(b => {
    b.onclick = () => op({ type: 'removePlayer', playerId: b.dataset.remove });
  });

  $app.querySelectorAll('[data-void]').forEach(b => {
    b.onclick = () => op({ type: 'voidRound', roundId: b.dataset.void });
  });

  $app.querySelectorAll('[data-num]').forEach(b => {
    b.onclick = () => {
      const n = +b.dataset.num;
      entry.n = entry.n.includes(n) ? entry.n.filter(v => v !== n) : [...entry.n, n];
      render();
    };
  });

  $app.querySelectorAll('[data-mod]').forEach(b => {
    b.onclick = () => {
      const m = +b.dataset.mod;
      entry.m = entry.m.includes(m) ? entry.m.filter(v => v !== m) : [...entry.m, m];
      render();
    };
  });

  const x2b = q('[data-x2]');
  if (x2b) x2b.onclick = () => { entry.x2 = !entry.x2; render(); };

  const pi = q('#pname');
  const pa = q('#padd');
  if (pa) pa.onclick = () => {
    if (pi.value.trim()) {
      op({ type: 'addPlayer', name: pi.value });
      pi.value = '';
    }
  };
  if (pi) pi.onkeydown = (e) => { if (e.key === 'Enter') pa.onclick(); };

  const ec = q('#ecancel');
  if (ec) ec.onclick = () => { entry = null; render(); };

  const es = q('#esave');
  if (es) es.onclick = () => {
    const e2 = entry;
    entry = null;
    op({ type: 'addRound', playerId: e2.playerId, n: e2.n, m: e2.m, x2: e2.x2, bust: false });
  };

  const eb = q('#ebust');
  if (eb) eb.onclick = () => {
    const e2 = entry;
    entry = null;
    op({ type: 'addRound', playerId: e2.playerId, bust: true });
  };

  const hb = q('#histbtn');
  if (hb) hb.onclick = () => { showHist = !showHist; render(); };

  const ar = q('#askreset');
  if (ar) ar.onclick = () => { confirmReset = true; render(); };

  const nr = q('#noreset');
  if (nr) nr.onclick = () => { confirmReset = false; render(); };

  const dr = q('#doreset');
  if (dr) dr.onclick = () => { confirmReset = false; op({ type: 'reset' }); };
}

// --- boot ------------------------------------------------------------------

refresh();

// Poll for updates, but don't clobber the page while a player is typing a name.
setInterval(() => {
  const pi = document.getElementById('pname');
  const typingName = pi && (pi === document.activeElement || pi.value.trim());
  if (!entry && !typingName) refresh();
}, 4000);
