// Multiplayer networking interface. The implementation is ./partykit.js (server: /party/server.ts,
// PartyServer on Cloudflare Workers).
// Screens only use the Net shape below, so the transport can change without touching them.
//
// @typedef {{ id: string, name: string, host: boolean, color: number, slot: number }} Player
//   color is a hex colour from PLAYER_COLORS; slot (0-9) picks the starting position and colour.
// @typedef {{ id: string, x: number, y: number, heading: number, speed: number, steer: number }} CarState
//
// @typedef {Object} Net
// @typedef {{ id: string, title: string, host: string, players: number, max: number }} RoomInfo
//   a room that can still be joined, as listed by watchRooms() in ./partykit.js
//
// @property {string|null} selfId                                      this player's id, once joined
// @property {{ id: string, title: string }|null} room                 the room we're in, once joined
// @property {Player[]} players                                        the latest player list
// @property {number|null} seed                                       random seed for starting positions, set on 'start'
// @property {(name: string, title?: string) => Promise<{id, title}>} createRoom   caller becomes host
// @property {(roomId: string, name: string) => Promise<{id, title}>} joinRoom      roomId from RoomInfo.id
// @property {() => void} startGame                                    host only; every player then gets 'start'
// @property {(state: Omit<CarState, 'id'>) => void} sendState         local car pose, ~15 times a second
// @property {(tileId: string) => void} sendSelected                   tell the others we selected an artwork
// @property {(event: string, fn: Function) => () => void} on          returns an unsubscribe function
// @property {() => void} leave
//
// Events:
//   'players'  (players: Player[])      the room's player list changed (join, leave, new host)
//   'start'    ({ seed })                the host started the game; pass seed to ctx.newRun()
//   'state'    (state: CarState)         another player's car moved
//   'selected' ({ id, tileId })         another player selected an artwork
//   'error'    (message: string)         e.g. lost connection to the server

// One colour per player slot: hues spread evenly round the colour wheel, starting at the
// single-player red. The length must match MAX_PLAYERS in party/server.ts.
export const PLAYER_COLORS = Array.from({ length: 10 }, (_, i) => hslToHex((355 + i * 36) % 360, 0.72, 0.56));

function hslToHex(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255);
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

export const cssColor = hex => '#' + hex.toString(16).padStart(6, '0');

export const selfPlayer = net => net?.players.find(p => p.id === net.selfId);

export function createEmitter() {
  const handlers = new Map();
  return {
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return () => handlers.get(event).delete(fn);
    },
    emit(event, ...args) {
      for (const fn of handlers.get(event) ?? []) fn(...args);
    },
  };
}
