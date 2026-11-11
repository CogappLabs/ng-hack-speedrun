# Art Drive: notes for Claude sessions

A browser game: drive a car across National Gallery artworks laid out as floor tiles.
Static site in `public/`, deployed to GitHub Pages on every push to `main`.

## Conventions

- **No build step for the game.** Plain ES modules loaded by the browser. Three.js and
  partysocket come from jsDelivr via the import map in `public/index.html`; any new library
  goes in that import map with an exact version (no `@latest`, no ranges).
- Run locally: `cd public && python3 -m http.server 8765` (use another port per worktree).
  For multiplayer, also run `npm install` once and then `npm run party:dev` (wrangler dev on
  localhost:8787). Open two tabs to play against yourself.
- The multiplayer server is PartyServer (`partyserver` package) on Cloudflare Workers + Durable
  Objects, not hosted PartyKit (shut down). Check its docs before changing `party/server.ts`,
  and run `npm run typecheck` afterwards. A new Durable Object class needs a binding *and* a new
  migration entry (next `tag`) in `wrangler.jsonc`; never edit or remove existing migrations.
- Deploy the server (`npm run party:deploy`) *before* pushing client changes that depend on
  it, because every push to `main` goes live immediately.
- Game logic uses 2D world coordinates (x east, y south). Three.js draws (x, y) at 3D (x, 0, y).
  One grid cell is `CELL` (256) units.
- Escape artwork titles and other data with `esc()` from `js/ui.js` before putting them in `innerHTML`.

## Structure

```
party/server.ts          multiplayer server: GameRoom (one per room: players, host, relays car poses +
                         selections) and RoomDirectory (single instance listing open rooms)
wrangler.jsonc           Cloudflare Worker config (deploy with `npm run party:deploy`)
public/
  index.html             markup shell + import map
  css/style.css          shared styles, then one section per screen
  js/main.js             boot, main loop, screen router (ctx.go)
  js/config.js           shared constants
  js/scene.js            the one renderer / scene / camera
  js/ui.js               DOM helpers (render, esc)
  js/inventory.js        the local player's selected artworks
  js/net/net.js          multiplayer Net interface, player colours, emitter
  js/net/partykit.js     Net implementation over partysocket (client side of party/server.ts)
  js/game/world.js       layout, tiles, image loading, textures
  js/game/car.js         car physics (stepCar) + 3D model; createCar() per player
  js/game/camera.js      chase camera, drag/scroll, groundPointAt()
  js/game/input.js       keyboard; driveInput(), onKey()
  js/screens/landing.js  feature 1
  js/screens/lobby.js    feature 2
  js/screens/play.js     feature 3
  js/screens/finish.js   feature 4
```

The 3D world renders behind every screen; screens draw their UI as DOM overlays in `#screen`.
Screen flow: `landing → play → finish → landing`, or `landing → lobby → play → finish → landing`.

## Contracts between features

Change these only on purpose, and say so in the commit message, because other sessions depend on them.

**Screen module**: the default export is `{ mount(root, ctx, data), unmount?(), update?(dt) }`.
`update` runs every frame while the screen is active. Move on with `ctx.go(name, data)`.

**ctx** (built in `main.js`):
- `ctx.car`: the local player's car (the camera follows it)
- `ctx.session`: `{ mode: 'single' | 'multi', net: Net | null }`
- `ctx.inventory`: see below
- `ctx.newRun(slot = 0)`: put the car at its start position (`Player.slot` in multiplayer) and empty the inventory

**Inventory** (`js/inventory.js`): `add(tile)`, `remove(id)`, `has(id)`, `reset()`, `items`,
`size`, `onChange(fn) → unsubscribe`. Items are `{ id, acc, title, url, pickedAt }`.

**Finish screen data**: `ctx.go('finish', { items, mode, others })`, where `others` is
`[{ name, color, items }]` for the other players in multiplayer (empty in single player).

**Net** (`js/net/net.js`): `createRoom(name, title?) → {id, title}`, `joinRoom(roomId, name)`,
`startGame()`, `sendState(pose)`, `sendSelected(tileId)`, `on(event, fn) → unsubscribe`,
`leave()`, `selfId`, `room`, `players`. The open-rooms list comes from
`watchRooms(fn) → stop` in `js/net/partykit.js` (fn gets `RoomInfo[]`, or null while disconnected). Events: `players`, `start`, `state`, `selected`, `error`. Full types are
in the file's header comment. The wire messages are listed in `js/net/partykit.js`; keep
them in step with `party/server.ts`.

**Multiplayer server host**: `PARTY_HOST` in `js/config.js`, which is `localhost:8787` when
the page is on localhost, otherwise `DEPLOYED_PARTY_HOST`
(`ng-hack-speedrun.cogapp.workers.dev`). `?party=<host>` in the URL overrides it.

## Feature ownership (for parallel sessions in separate worktrees)

| Feature | Owns | Avoid editing |
|---|---|---|
| 1. Landing page | `screens/landing.js`, landing CSS section | everything else |
| 2. Waiting room + networking | `screens/lobby.js`, `net/`, `party/` | `play.js` (agree changes to the Net events) |
| 3. Gameplay, multiplayer driving, selection, inventory display | `screens/play.js`, `game/*`, `inventory.js` | other screens |
| 4. Final screen | `screens/finish.js`, finish CSS section | everything else |

Shared files (`main.js`, `ui.js`, `config.js`, the top of `style.css`): keep changes small and
commit them separately so they merge easily.
