import { sanitizeRound } from '../public/scoring.js';

export class GameDO {
  constructor(state) {
    this.state = state;
    // Answer keepalive pings without waking a hibernated object.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
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
    const action = url.pathname.split('/').pop();

    if (request.method === 'GET' && action === 'ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify(await this.getGame()));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === 'GET' && action === 'state') {
      return Response.json(await this.getGame());
    }

    if (request.method === 'POST' && action === 'op') {
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
      this.broadcast(game);
      return Response.json(game);
    }

    return new Response('not found', { status: 404 });
  }

  broadcast(game) {
    const payload = JSON.stringify(game);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(payload);
      } catch { /* socket already closing */ }
    }
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
        const id = crypto.randomUUID();
        game.rounds[id] = { id, playerId: op.playerId, ...sanitizeRound(op), ts: Date.now() };
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

const ROOM_RE = /^\/api\/g\/([A-Za-z0-9]{4,8})\/(state|op|ws)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(ROOM_RE);
    if (m) {
      const id = env.GAME.idFromName(m[1].toUpperCase());
      return env.GAME.get(id).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) {
      return new Response('not found', { status: 404 });
    }
    // Any other non-asset path (e.g. /g/CODE) is a client route: serve the shell.
    return env.ASSETS.fetch(new URL('/index.html', url));
  },
};
