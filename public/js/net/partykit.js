// Net implementation over PartyServer on Cloudflare Workers (see ./net.js for the interface,
// /party/server.ts for the server). One room per game; the room id is the 4-character room code.
//
// Client → server: { type: 'join', name, create } · { type: 'start' }
//                  { type: 'state', x, y, heading, speed, steer } · { type: 'selected', tileId }
// Server → client: { type: 'joined', selfId, code } · { type: 'players', players } · { type: 'start' }
//                  { type: 'state', id, ...pose } · { type: 'selected', id, tileId } · { type: 'error', message }
import PartySocket from 'partysocket';
import { PARTY_HOST } from '../config.js';
import { createEmitter, PLAYER_COLORS } from './net.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no 0/O or 1/I, so codes are easy to read out
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

/** @returns {import('./net.js').Net} */
export function createPartyNet() {
  const { on, emit } = createEmitter();
  let socket = null;

  const send = msg => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };

  function connect(code, name, create) {
    if (!PARTY_HOST) return Promise.reject(new Error('No multiplayer server is set up for this site yet.'));
    net.leave();
    return new Promise((resolve, reject) => {
      // No automatic reconnect: the server can't put a dropped player back into a started game.
      const s = socket = new PartySocket({ host: PARTY_HOST, party: 'game-room', room: code, maxRetries: 0 });
      let joined = false;
      const close = () => { if (socket === s) socket = null; s.close(); };

      s.addEventListener('open', () => s.send(JSON.stringify({ type: 'join', name, create })));
      s.addEventListener('close', () => {
        if (socket !== s) return;  // we closed it on purpose
        socket = null;
        if (joined) emit('error', 'Lost connection to the multiplayer server.');
        else reject(new Error('Couldn’t reach the multiplayer server.'));
      });
      s.addEventListener('message', e => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        switch (m.type) {
          case 'joined':
            joined = true;
            net.selfId = m.selfId;
            resolve(m.code);
            break;
          case 'error':
            if (joined) emit('error', m.message);
            else { close(); reject(new Error(m.message)); }
            break;
          case 'players':
            net.players = m.players.map(p => ({ ...p, color: PLAYER_COLORS[p.color % PLAYER_COLORS.length] }));
            emit('players', net.players);
            break;
          case 'start':
            emit('start');
            break;
          case 'state': {
            const { type, ...state } = m;
            emit('state', state);
            break;
          }
          case 'selected':
            emit('selected', { id: m.id, tileId: m.tileId });
            break;
        }
      });
    });
  }

  const net = {
    selfId: null,
    players: [],
    on,
    createRoom: name => connect(newCode(), name, true),
    joinRoom: (code, name) => connect(code.trim().toUpperCase(), name, false),
    startGame: () => send({ type: 'start' }),
    sendState: ({ x, y, heading, speed, steer }) => send({
      type: 'state', x: Math.round(x), y: Math.round(y),
      heading: +heading.toFixed(3), speed: Math.round(speed), steer,
    }),
    sendSelected: tileId => send({ type: 'selected', tileId }),
    leave() {
      if (socket) { const s = socket; socket = null; s.close(); }
      net.selfId = null;
      net.players = [];
    },
  };
  return net;
}
