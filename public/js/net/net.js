// Multiplayer networking interface. The implementation is ./partykit.js (server: /party/server.ts,
// PartyServer on Cloudflare Workers).
// Screens only use the Net shape below, so the transport can change without touching them.
//
// @typedef {{ id: string, name: string, host: boolean, color: number, slot: number }} Player
//   color is a hex colour from PLAYER_COLORS; slot (0-5) picks the starting position.
// @typedef {{ id: string, x: number, y: number, heading: number, speed: number, steer: number }} CarState
//
// @typedef {Object} Net
// @typedef {{ id: string, title: string, host: string, players: number, max: number }} RoomInfo
//   a room that can still be joined, as listed by watchRooms() in ./partykit.js
//
// @property {string|null} selfId                                      this player's id, once joined
// @property {{ id: string, title: string }|null} room                 the room we're in, once joined
// @property {Player[]} players                                        the latest player list
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
//   'start'    ()                        the host started the game
//   'state'    (state: CarState)         another player's car moved
//   'selected' ({ id, tileId })         another player selected an artwork
//   'error'    (message: string)         e.g. lost connection to the server

export const PLAYER_COLORS = [0xe63946, 0x2a9d8f, 0xe9c46a, 0x6a4c93, 0xf4a261, 0x4cc9f0];

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
