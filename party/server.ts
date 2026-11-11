// Multiplayer server for Art Drive, using PartyServer on Cloudflare Workers + Durable Objects.
// One GameRoom instance = one game room (the room code). It keeps the player list, picks the
// host, and relays car positions and selections. The browser side is public/js/net/partykit.js,
// which also lists the message shapes.
//
// Clients connect to /parties/game-room/<CODE>: routePartykitRequest maps the GameRoom
// binding (wrangler.jsonc) to the kebab-case name "game-room".
import { routePartykitRequest, Server, type Connection } from "partyserver";

const MAX_PLAYERS = 6;   // one per colour in PLAYER_COLORS (public/js/net/net.js)

type Player = { id: string; name: string; host: boolean; color: number; slot: number };

type ClientMessage =
  | { type: "join"; name: string; create: boolean }
  | { type: "start" }
  | { type: "state"; x: number; y: number; heading: number; speed: number; steer: number }
  | { type: "selected"; tileId: string };

type Env = { GameRoom: DurableObjectNamespace<GameRoom> };

// State lives in memory, which is fine because hibernation is off (the default): the room
// stays awake while anyone is connected, and an empty room has nothing worth keeping.
export class GameRoom extends Server<Env> {
  players = new Map<string, Player>();   // in join order, so the first one is the longest-standing
  started = false;

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
    if (msg.create && this.players.size) return fail("That room code is already in use. Try again.");
    if (!msg.create && !this.players.size) return fail("No room with that code.");
    if (this.started) return fail("That game has already started.");
    if (this.players.size >= MAX_PLAYERS) return fail("That room is full.");

    const used = new Set([...this.players.values()].map(p => p.slot));
    const slot = [...Array(MAX_PLAYERS).keys()].find(i => !used.has(i))!;
    const name = String(msg.name ?? "").trim().slice(0, 20) || "Player";
    this.players.set(conn.id, { id: conn.id, name, host: this.players.size === 0, color: slot, slot });
    conn.send(JSON.stringify({ type: "joined", selfId: conn.id, code: this.name }));
    this.sendPlayers();
  }

  onClose(conn: Connection) {
    const left = this.players.get(conn.id);
    if (!left) return;
    this.players.delete(conn.id);
    if (left.host) {
      const next = this.players.values().next().value;
      if (next) next.host = true;
    }
    if (!this.players.size) this.started = false;
    this.sendPlayers();
  }

  sendPlayers() {
    this.broadcast(JSON.stringify({ type: "players", players: [...this.players.values()] }));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (await routePartykitRequest(request, env)) || new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
