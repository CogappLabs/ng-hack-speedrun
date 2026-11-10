// Multiplayer networking interface.
//
// GitHub Pages only serves static files, so a real implementation needs an outside realtime
// service (e.g. PartyKit, Firebase, Supabase Realtime, or WebRTC via PeerJS). Whatever is
// chosen, it should implement the Net shape below so the lobby and play screens don't change.
// createLocalNet() is an offline stand-in: you can create a room with only yourself in it
// and start the game, but you can't join another room.
//
// @typedef {{ id: string, name: string, host: boolean, color: number }} Player
// @typedef {{ id: string, x: number, y: number, heading: number, speed: number, steer: number }} CarState
//
// @typedef {Object} Net
// @property {string} selfId
// @property {(name: string) => Promise<string>} createRoom          resolves to the room code; caller is host
// @property {(code: string, name: string) => Promise<void>} joinRoom
// @property {() => void} startGame                                   host only; every player then gets 'start'
// @property {(state: Omit<CarState, 'id'>) => void} sendState        local car pose, send ~10-20 times a second
// @property {(event: NetEvent, fn: Function) => () => void} on        returns an unsubscribe function
// @property {() => void} leave
//
// Events (NetEvent):
//   'players'  (players: Player[])     the room's player list changed (including on join)
//   'start'    ()                       the host started the game
//   'state'    (state: CarState)        another player's car moved
//   'selected' ({ id, tileId })        another player selected an artwork (optional, for gameplay)
//   'error'    (message: string)

export const PLAYER_COLORS = [0xe63946, 0x2a9d8f, 0xe9c46a, 0x6a4c93, 0xf4a261, 0x4cc9f0];

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

/** @returns {Net} */
export function createLocalNet() {
  const { on, emit } = createEmitter();
  const selfId = 'local';
  let players = [];
  return {
    selfId,
    on,
    async createRoom(name) {
      players = [{ id: selfId, name, host: true, color: PLAYER_COLORS[0] }];
      queueMicrotask(() => emit('players', players));
      return 'LOCAL';
    },
    async joinRoom() {
      throw new Error('Joining rooms needs a multiplayer server, which isn’t set up yet.');
    },
    startGame() { queueMicrotask(() => emit('start')); },
    sendState() {},
    leave() { players = []; },
  };
}
