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
  js/inventory.js        the local player's photographed artworks (at most COLLECTION_SIZE)
  js/net/net.js          multiplayer Net interface, player colours, emitter
  js/net/partykit.js     Net implementation over partysocket (client side of party/server.ts)
  js/game/world.js       layout, tiles, image loading, textures
  js/game/car.js         car physics (stepCar) + 3D model; createCar() per player
  js/game/camera.js      chase camera, drag/scroll, groundPointAt()
  js/game/minimap.js     locator map (top right of the play screen)
  js/hud/preview.js      artwork preview (top centre of the play screen)
  js/hud/filmstrip.js    film strip of photographed artworks (bottom), with the fly-in animation
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
- `ctx.challenge`: this run's `{ label, name, tiles }`, e.g. `{ label: 'hat', name: 'hats' }`
- `ctx.newRun(slot = 0, seed = random)`: put photographed artworks back on the map, pick the
  challenge, put the car on its random starting tile and empty the inventory. In multiplayer pass `Player.slot` and the seed from the `start` event, so all
  players agree where everyone starts (`spawnPoint(seed, slot)` in `js/game/world.js`).

**Inventory** (`js/inventory.js`): `add(tile)` (false if already there or full), `remove(id)`,
`has(id)`, `reset()`, `items`, `size`, `full`, `onChange(fn) → unsubscribe`. Items are
`{ id, acc, title, url, pickedAt }`. The cap is `COLLECTION_SIZE` in `js/config.js` (10), which
must match `MAX_PICKS` in `party/server.ts`.

**Game rules**: the challenge is "photograph COLLECTION_SIZE examples of `challenge.name`". The
game ends when anyone has COLLECTION_SIZE photos (single player: you; multiplayer: the server's
`end` event). A player's score is how many of their photos have `challenge.label` in the tile's
`labels` (`tileMatches(tile, challenge)` in `js/game/world.js`). Scores are revealed only on
the finish screen. The UI says "photograph"; code still uses inventory/collect names.

**Challenges** come from `layout.json` (`world.challenges`), built by `scripts/build_layout.py`
from `input/filtered_subjects.tsv`. `challengeFor(seed)` picks one, so all players agree.

**Photographed artworks leave the map**: `removeTile(tile)` and `restoreTiles()` in
`js/game/world.js`. `tileAt()` treats a removed tile as a gap, and the locator map redraws
when `world.version` changes. In multiplayer, only remove a tile (or add it to the inventory)
when the server's `selected` event arrives, never on the key press.

**Finish screen data**: `ctx.go('finish', { mode, challenge, endedBy, players })`. `endedBy` is
the name of whoever filled their film ('You' for us, null if we quit). `players` is
`[{ name, color, self, score, photos: [{ id, acc, title, url, match }] }]`, including players
who left mid-game.

**Net** (`js/net/net.js`): `createRoom(name, title?) → {id, title}`, `joinRoom(roomId, name)`,
`startGame()`, `sendState(pose)`, `selectTile(tileId)`, `on(event, fn) → unsubscribe`,
`leave()`, `selfId`, `room`, `seed`, `players`. The open-rooms list comes from
`watchRooms(fn) → stop` in `js/net/partykit.js` (fn gets `RoomInfo[]`, or null while disconnected). Events: `players`, `start` (`{ seed }`), `state`, `selected` (`{ id, tileId }`, sent to
everyone including the photographer, first claim only), `end` (`{ id }`: that player filled
their film, game over for everyone), `error`. Full types are
in the file's header comment. The wire messages are listed in `js/net/partykit.js`; keep
them in step with `party/server.ts`.

**Room size**: `MAX_PLAYERS` in `party/server.ts` (10). `PLAYER_COLORS` in `js/net/net.js` must
have the same length, since a player's slot picks their colour.

**Multiplayer server host**: `PARTY_HOST` in `js/config.js`, which is `localhost:8787` when
the page is on localhost, otherwise `DEPLOYED_PARTY_HOST`
(`ng-hack-speedrun.cogapp.workers.dev`). `?party=<host>` in the URL overrides it.

## Feature ownership (for parallel sessions in separate worktrees)

| Feature | Owns | Avoid editing |
|---|---|---|
| 1. Landing page | `screens/landing.js`, landing CSS section | everything else |
| 2. Waiting room + networking | `screens/lobby.js`, `net/`, `party/` | `play.js` (agree changes to the Net events) |
| 3. Gameplay, multiplayer driving, selection, inventory display | `screens/play.js`, `game/*`, `hud/*`, `inventory.js` | other screens |
| 4. Final screen | `screens/finish.js`, finish CSS section | everything else |

Shared files (`main.js`, `ui.js`, `config.js`, the top of `style.css`): keep changes small and
commit them separately so they merge easily.
