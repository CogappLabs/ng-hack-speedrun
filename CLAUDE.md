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
  js/sound.js            synthesised sound effects + engine noise (Web Audio), M to mute
  js/inventory.js        the local player's photographed artworks (at most COLLECTION_SIZE)
  js/options.js          game options ({ map, difficulty, mode, minutes }), saved in localStorage
  js/net/net.js          multiplayer Net interface, player colours, emitter
  js/net/partykit.js     Net implementation over partysocket (client side of party/server.ts)
  js/game/world.js       layout, tiles, image loading, textures
  js/game/car.js         car physics (stepCar) + 3D model; createCar() per player
  js/game/camera.js      chase camera, drag/scroll, groundPointAt()
  js/game/minimap.js     locator map (top right of the play screen)
  js/hud/preview.js      artwork preview (top centre of the play screen)
  js/hud/filmstrip.js    film strip of photographed artworks (bottom), with the fly-in animation
  js/game/input.js       keyboard (arrows/WASD) + gamepad; driveInput(), lookInput(), onKey()
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
- `ctx.options`: the player's chosen `{ map, difficulty, mode, minutes }` (landing screen; also used for rooms they create)
- `ctx.runOptions`: this run's options (ctx.options, or the room's in multiplayer)
- `ctx.newRun(slot = 0, seed = random, options = ctx.options)`: put photographed artworks back on the map, pick the
  challenge, set `ctx.runOptions`, put the car on its random starting tile and empty the inventory. In multiplayer pass `Player.slot`, and the seed and options from the `start` event, so all
  players agree where everyone starts (`spawnPoint(seed, slot)` in `js/game/world.js`).
  The world must already be on the options' map: `await useMap(map, difficulty)` first.

**Maps**: one layout per map style (`visual` default, `curatorial`, `clip`) and difficulty
(`easy`, `medium` default, `hard`): `public/layout_<map>_<difficulty>.json`, built by
`scripts/build_layout.py --type <map> --slack <n>`. `useMap(map, difficulty)` in
`js/game/world.js` switches the world (`world.map` is the current one; `world.version` goes up).
Tiles are kept by id across maps, so downloaded images are reused. A tile's index in
`world.tiles` (layout order) drives `spawnPoint`, so every player must be on the same map.
`public/layout.json` is no longer loaded by the game.

**Inventory** (`js/inventory.js`): `add(tile)` (false if already there or full), `remove(id)`,
`has(id)`, `reset()`, `items`, `size`, `full`, `onChange(fn) → unsubscribe`. Items are
`{ id, acc, title, url, pickedAt }`. The cap is `COLLECTION_SIZE` in `js/config.js` (10), which
must match `MAX_PICKS` in `party/server.ts`.

**Game rules**: two modes (`js/options.js`, mirrored in `party/server.ts`). *Time mode* (the
default): photograph as many `challenge.name` as you can in `minutes` (1, 2, 3, 5 or 10; default 2);
the game ends when the clock runs out or every film is full. *Challenge mode*: "photograph
COLLECTION_SIZE examples of `challenge.name`"; the game ends when anyone has COLLECTION_SIZE
photos. Single player: the play screen ends it; multiplayer: the server's `end` event (the server
runs the clock). In multiplayer the room creator's options apply to everyone. A player's score is how many of their photos have `challenge.label` in the tile's
`labels` (`tileMatches(tile, challenge)` in `js/game/world.js`). Scores are revealed only on
the finish screen. The UI says "photograph"; code still uses inventory/collect names.

**Challenges** come from `layout.json` (`world.challenges`), built by `scripts/build_layout.py`
from `input/filtered_subjects.tsv`. `challengeFor(seed)` picks one, so all players agree.

**Photographed artworks leave the map**: `removeTile(tile)` and `restoreTiles()` in
`js/game/world.js`. `tileAt()` treats a removed tile as a gap, and the locator map redraws
when `world.version` changes. In multiplayer, only remove a tile (or add it to the inventory)
when the server's `selected` event arrives, never on the key press.

**Finish screen data**: `ctx.go('finish', { mode, options, challenge, endedBy, reason, players })`.
`reason` is `'full' | 'time' | 'all-full' | 'quit'`. `endedBy` is the name of whoever filled
their film first ('You' for us), else null. `players` is
`[{ name, color, self, score, photos: [{ id, acc, title, url, match }] }]`, including players
who left mid-game.

**Net** (`js/net/net.js`): `createRoom(name, title?, options?) → {id, title, options}`, `joinRoom(roomId, name)`,
`startGame()`, `sendState(pose)`, `selectTile(tileId)`, `on(event, fn) → unsubscribe`,
`leave()`, `selfId`, `room`, `seed`, `players`. The open-rooms list comes from
`watchRooms(fn) → stop` in `js/net/partykit.js` (fn gets `RoomInfo[]`, or null while disconnected). Events: `players`, `start` (`{ seed, options }`), `state`, `selected` (`{ id, tileId }`, sent to
everyone including the photographer, first claim only), `end` (`{ id, reason }`: game over for
everyone; reason `'full'` = player `id` filled their film, `'time'`, or `'all-full'` with id null), `error`. Full types are
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
