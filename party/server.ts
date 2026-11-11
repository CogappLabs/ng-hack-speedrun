// Multiplayer server for Art Drive, using PartyServer on Cloudflare Workers + Durable Objects.
//
// - GameRoom: one instance per game room. Keeps the player list, picks the host, and relays
//   car positions and selections. Clients connect to /parties/game-room/<room id>.
// - RoomDirectory: a single instance ("all") listing the rooms that can still be joined.
//   Lobby screens connect to /parties/room-directory/all to get the list as it changes.
//   GameRooms report to it over Durable Object RPC (setRoom / removeRoom).
//
// routePartykitRequest maps each binding in wrangler.jsonc to its kebab-case name
// (GameRoom → game-room). The browser side is public/js/net/partykit.js, which also lists the
// message shapes.
import { getServerByName, routePartykitRequest, Server, type Connection } from "partyserver";

const MAX_PLAYERS = 6;          // one per colour in PLAYER_COLORS (public/js/net/net.js)
const HEARTBEAT_MS = 30_000;    // open rooms re-announce themselves this often...
const STALE_MS = 75_000;        // ...and the directory drops rooms it hasn't heard from in this long
const DIRECTORY = "all";        // the single RoomDirectory instance

type Env = {
  GameRoom: DurableObjectNamespace<GameRoom>;
  RoomDirectory: DurableObjectNamespace<RoomDirectory>;
};

type Player = { id: string; name: string; host: boolean; color: number; slot: number };

export type RoomInfo = { id: string; title: string; host: string; players: number; max: number };

type ClientMessage =
  | { type: "join"; name: string; create: boolean; title?: string }
  | { type: "start" }
  | { type: "state"; x: number; y: number; heading: number; speed: number; steer: number }
  | { type: "selected"; tileId: string };

const clean = (s: unknown, max: number) => String(s ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// State lives in memory, which is fine because hibernation is off (the default): a room
// stays awake while anyone is connected, and an empty room has nothing worth keeping.
export class GameRoom extends Server<Env> {
  players = new Map<string, Player>();   // in join order, so the first one is the longest-standing
  started = false;
  title = "";
  announcing = Promise.resolve();

  get open() { return this.players.size > 0 && !this.started; }

  onMessage(sender: Connection, raw: string | ArrayBuffer) {
    if (typeof raw !== "string") return;
    let msg: ClientMessage;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "join") return this.join(msg, sender);

    // Everything else is only accepted from players who have joined.
    const me = this.players.get(sender.id);
    if (!me) return;

    if (msg.type === "start" && me.host && !this.started) {
      this.started = true;
      this.broadcast(JSON.stringify({ type: "start" }));
      this.announce();
    } else if (msg.type === "state") {
      const { x, y, heading, speed, steer } = msg;
      if (![x, y, heading, speed, steer].every(Number.isFinite)) return;
      this.broadcast(JSON.stringify({ type: "state", id: me.id, x, y, heading, speed, steer }), [sender.id]);
    } else if (msg.type === "selected" && typeof msg.tileId === "string") {
      this.broadcast(JSON.stringify({ type: "selected", id: me.id, tileId: msg.tileId }), [sender.id]);
    }
  }

  join(msg: Extract<ClientMessage, { type: "join" }>, conn: Connection) {
    const fail = (message: string) => conn.send(JSON.stringify({ type: "error", message }));
    if (this.players.has(conn.id)) return;
    // Rooms exist as soon as anyone connects, so "create" and "join" are told apart here.
    if (msg.create && this.players.size) return fail("Couldn’t create the room. Please try again.");
    if (!msg.create && !this.players.size) return fail("That room has closed.");
    if (this.started) return fail("That game has already started.");
    if (this.players.size >= MAX_PLAYERS) return fail("That room is full.");

    const used = new Set([...this.players.values()].map(p => p.slot));
    const slot = [...Array(MAX_PLAYERS).keys()].find(i => !used.has(i))!;
    const name = clean(msg.name, 20) || "Player";
    if (msg.create) this.title = clean(msg.title, 30) || `${name}’s room`;
    this.players.set(conn.id, { id: conn.id, name, host: this.players.size === 0, color: slot, slot });
    conn.send(JSON.stringify({ type: "joined", selfId: conn.id, room: { id: this.name, title: this.title } }));
    this.sendPlayers();
    this.announce();
  }

  onClose(conn: Connection) {
    const left = this.players.get(conn.id);
    if (!left) return;
    this.players.delete(conn.id);
    if (left.host) {
      const next = this.players.values().next().value;
      if (next) next.host = true;
    }
    if (!this.players.size) {
      this.started = false;
      this.title = "";
    }
    this.sendPlayers();
    this.announce();
  }

  // Heartbeat: keep the directory entry fresh while the room is open.
  onAlarm() {
    this.announce();
  }

  sendPlayers() {
    this.broadcast(JSON.stringify({ type: "players", players: [...this.players.values()] }));
  }

  // Tell the directory about this room (or that it's no longer joinable). Calls are queued so
  // they arrive in order. A directory failure is logged but never breaks the game itself.
  announce() {
    this.announcing = this.announcing.then(async () => {
      try {
        const directory = await getServerByName(this.env.RoomDirectory, DIRECTORY);
        if (this.open) {
          const host = [...this.players.values()].find(p => p.host)!;
          await directory.setRoom({
            id: this.name, title: this.title, host: host.name, players: this.players.size, max: MAX_PLAYERS,
          });
          await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
        } else {
          await directory.removeRoom(this.name);
          await this.ctx.storage.deleteAlarm();
        }
      } catch (err) {
        console.error("Room directory update failed", err);
      }
    });
  }
}

export class RoomDirectory extends Server<Env> {
  rooms = new Map<string, RoomInfo & { seen: number }>();

  onConnect(conn: Connection) {
    this.prune();
    conn.send(this.listMessage());
  }

  // Lobby clients only listen; ignore anything they send.
  onMessage() {}

  // --- RPC, called by GameRoom ---
  async setRoom(info: RoomInfo) {
    this.rooms.set(info.id, { ...info, seen: Date.now() });
    await this.changed();
  }

  async removeRoom(id: string) {
    if (this.rooms.delete(id)) await this.changed();
  }

  // Drop rooms whose heartbeats stopped (e.g. the room's server restarted mid-game).
  async onAlarm() {
    if (this.prune()) this.broadcast(this.listMessage());
    await this.scheduleCheck();
  }

  prune() {
    const cutoff = Date.now() - STALE_MS;
    let removed = false;
    for (const [id, r] of this.rooms) if (r.seen < cutoff) { this.rooms.delete(id); removed = true; }
    return removed;
  }

  async changed() {
    this.prune();
    this.broadcast(this.listMessage());
    await this.scheduleCheck();
  }

  async scheduleCheck() {
    if (!this.rooms.size) return this.ctx.storage.deleteAlarm();
    if (!(await this.ctx.storage.getAlarm())) await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS);
  }

  listMessage() {
    const rooms = [...this.rooms.values()].map(({ seen, ...r }) => r);
    return JSON.stringify({ type: "rooms", rooms });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routePartykitRequest(request, env)) || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
