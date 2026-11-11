// Net implementation over PartyServer on Cloudflare Workers (see ./net.js for the interface,
// /party/server.ts for the server). Two kinds of connection:
//
// Game room (/parties/game-room/<room id>), one per game:
//   Client → server: { type: 'join', name, create, title? } · { type: 'start' }
//                    { type: 'state', x, y, heading, speed, steer } · { type: 'select', tileId }
//   Server → client: { type: 'joined', selfId, room: { id, title } } · { type: 'players', players }
//                    { type: 'start', seed } · { type: 'state', id, ...pose } · { type: 'selected', id, tileId }
//                    { type: 'error', message }
//
// Room directory (/parties/room-directory/all), listen only:
//   Server → client: { type: 'rooms', rooms: [{ id, title, host, players, max }] }
import PartySocket from 'partysocket';
import { PARTY_HOST } from '../config.js';
import { createEmitter, PLAYER_COLORS } from './net.js';

// Room ids are internal (players pick rooms by title), so they just need to be unique.
const newRoomId = () => crypto.randomUUID().slice(0, 8);
const NO_SERVER = 'No multiplayer server is set up for this site yet.';

/** @returns {import('./net.js').Net} */
export function createPartyNet() {
  const { on, emit } = createEmitter();
  let socket = null;

  const send = msg => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); };

  function connect(roomId, name, create, title) {
    if (!PARTY_HOST) return Promise.reject(new Error(NO_SERVER));
    net.leave();
    return new Promise((resolve, reject) => {
      // No automatic reconnect: the server can't put a dropped player back into a started game.
      const s = socket = new PartySocket({ host: PARTY_HOST, party: 'game-room', room: roomId, maxRetries: 0 });
      let joined = false;
      const close = () => { if (socket === s) socket = null; s.close(); };

      s.addEventListener('open', () => s.send(JSON.stringify({ type: 'join', name, create, title })));
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
            net.room = m.room;
            resolve(m.room);
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
            net.seed = m.seed;
            emit('start', { seed: m.seed });
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
    room: null,
    seed: null,
    players: [],
    on,
    createRoom: (name, title) => connect(newRoomId(), name, true, title),
    joinRoom: (roomId, name) => connect(roomId, name, false),
    startGame: () => send({ type: 'start' }),
    sendState: ({ x, y, heading, speed, steer }) => send({
      type: 'state', x: Math.round(x), y: Math.round(y),
      heading: +heading.toFixed(3), speed: Math.round(speed), steer,
    }),
    selectTile: tileId => send({ type: 'select', tileId }),
    leave() {
      if (socket) { const s = socket; socket = null; s.close(); }
      net.selfId = null;
      net.room = null;
      net.seed = null;
      net.players = [];
    },
  };
  return net;
}

// Watch the list of rooms that can still be joined. fn(rooms) is called with the full list each
// time it changes, or fn(null) while not connected. Returns a function that stops watching.
export function watchRooms(fn) {
  if (!PARTY_HOST) {
    fn(null);
    return () => {};
  }
  const s = new PartySocket({ host: PARTY_HOST, party: 'room-directory', room: 'all' });
  s.addEventListener('message', e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'rooms') fn(m.rooms);
  });
  s.addEventListener('close', () => fn(null));  // PartySocket reconnects by itself
  return () => s.close();
}
