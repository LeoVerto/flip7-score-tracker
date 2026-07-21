export class GameDO {
  constructor(state) {
    this.state = state;
  }

  emptyGame() {
    return {
      gameId: crypto.randomUUID(),
      startedAt: Date.now(),
      players: {}, // id -> {id, name, removed}
      rounds: {}, // id -> {id, playerId, score, n, m, x2, bust, voided, ts}
    };
  }

  async getGame() {
    return await this.state.storage.get('game') || this.emptyGame();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/state') {
      return Response.json(await this.getGame());
    }
    if (request.method === 'POST' && url.pathname === '/api/op') {
      let op;
      try {
        op = await request.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }
      const game = await this.getGame();
      const err = this.apply(game, op);
      if (err) return new Response(err, { status: 400 });
      await this.state.storage.put('game', game);
      return Response.json(game);
    }
    return new Response('not found', { status: 404 });
  }

  apply(game, op) {
    switch (op.type) {
      case 'addPlayer': {
        const name = String(op.name || '').trim().slice(0, 30);
        if (!name) return 'name required';
        const id = crypto.randomUUID();
        game.players[id] = { id, name };
        return null;
      }
      case 'removePlayer': {
        const p = game.players[op.playerId];
        if (!p) return 'no such player';
        p.removed = true;
        return null;
      }
      case 'addRound': {
        if (!game.players[op.playerId]) return 'no such player';
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
      case 'voidRound': {
        const r = game.rounds[op.roundId];
        if (!r) return 'no such round';
        r.voided = true;
        return null;
      }
      case 'reset': {
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
        return 'unknown op';
    }
  }
}

function uniqInts(arr, min, max) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= min && v <= max))];
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const id = env.GAME.idFromName('global');
      return env.GAME.get(id).fetch(request);
    }
    return new Response('not found', { status: 404 });
  },
};
