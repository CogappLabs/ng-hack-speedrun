# ng-hack-speedrun
Dash to gather artworks. Created for the National Gallery Hack Day November 2026

A web game where you drive a car across a 3D landscape made of National Gallery
artworks, laid flat like floor tiles. Paintings that look similar sit next to each other, so you drive
between neighbouring works and (soon) jump across the gaps between groups. Play on your
own or with up to 5 others.

Play it at https://cogapplabs.github.io/ng-hack-speedrun/.

## Quick start

Requires Python 3 and [uv](https://docs.astral.sh/uv/). Multiplayer also needs Node.js.

```sh
# 1. Build the tile layout (only needed when the input data or layout settings change)
uv run scripts/build_layout.py

# 2. Serve the game
cd public && python3 -m http.server 8765
```

Open http://localhost:8765/.

### Multiplayer locally

Multiplayer uses a small server in `party/server.ts`, built with
[PartyServer](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) and run
on Cloudflare Workers (one Durable Object per game room).

```sh
npm install          # once
npm run party:dev    # multiplayer server on localhost:8787 (wrangler dev), alongside the game server above
```

Open the game in two tabs. Choose Multiplayer, create a room in one tab, then join it from the
other with the 4-character code. On localhost the game connects to the local server
automatically.

## Deployment

Every push to `main` publishes `public/` to GitHub Pages, using
`.github/workflows/pages.yml`. Commit `public/layout.json` after rebuilding it,
because the workflow doesn't run the build script. You can also run the
workflow by hand from the Actions tab.

One-time setup: in the repository's **Settings → Pages**, set **Source** to
**GitHub Actions**.

The multiplayer server is deployed separately, as a Cloudflare Worker at
`ng-hack-speedrun.cogapp.workers.dev`. It fits in the Workers Free plan. To deploy it:

```sh
npx wrangler login     # once: opens a browser to authorise your Cloudflare account
npm run party:deploy   # prints the URL, e.g. https://ng-hack-speedrun.<your-subdomain>.workers.dev
```

The first deploy asks you to pick a `workers.dev` subdomain if your account doesn't have one
yet. Redeploy whenever `party/server.ts` changes. `npm run typecheck` checks the server code.

The live game finds the server through `DEPLOYED_PARTY_HOST` in `public/js/config.js`
(the host only, without `https://`). If you deploy to a different account, update it and
push. To try the live game against another server without changing the code, add
`?party=<host>` to the page URL.

## Controls

| Input | Action |
|---|---|
| ↑ | Accelerate |
| ↓ | Brake, then reverse |
| ← / → | Steer (only works while moving) |
| Scroll wheel | Move the camera closer to or further from the car |
| Drag | Swing the camera around the car (press any arrow key to swing it back) |
| Hover | Show the artwork's title |
| Space | Select the artwork under the car (placeholder mechanic) |
| Esc | Finish the run and see your selections |

In multiplayer, the host starts the game for everyone. Other players' cars show their names,
the HUD shows everyone's selection count, and the final screen shows what the others had
selected when you finished.

The HUD shows the artwork under the car, or "Off-road" when you're in a gap.

## How it works

### Input data

`input/vectors_2d.tsv` has one row per artwork: an image URL (`image_mid_url`)
and several 2D projections (`clip_*`, `curatorial_*`, `visual_*`, `combined_*`).
The layout uses `visual_x` / `visual_y`, which places artworks that look alike
close together. Rows with no image or coordinates are skipped (12 of 2,411).

### Layout (`scripts/build_layout.py`)

The projection gives continuous points, and many of them overlap. The script
snaps each artwork to its own cell of a square grid:

1. Scale the points onto a grid with `--slack` cells per artwork (default **3**).
2. Give each artwork a unique cell, keeping the total squared distance moved as
   small as possible (Hungarian algorithm, `scipy.optimize.linear_sum_assignment`).
3. Write `public/layout.json`: `{cols, rows, tiles: [{id, acc, title, url, col, row}]}`.

Using several cells per artwork keeps the outline close to the original scatter
plot and leaves gaps between groups. These gaps are the "islands" you'll jump
between. The slack value controls the trade-off:

| `--slack` | Average move (cells) | Islands | Largest island |
|---|---|---|---|
| 2 | 2.2 | 4 | 2,326 |
| **3** | **1.1** | **58** | **1,491** |
| 4 | 0.76 | 126 | 824 |
| 8 | 0.5 | 465 | 205 |

Islands count side-by-side tiles only, not diagonal ones.

Other options:

```sh
uv run scripts/build_layout.py --slack 4 --preview   # also prints a text map of used cells
uv run scripts/build_layout.py [input.tsv] [output.json]
```

The script lists its dependencies (numpy, scipy) inline, so `uv run` installs
them automatically into a temporary environment.

### Game (`public/`)

Plain ES modules using [Three.js](https://threejs.org/) (0.170.0) and
[partysocket](https://www.npmjs.com/package/partysocket) (1.3.0), both loaded from jsDelivr
through an import map. There is no build step. `CLAUDE.md` describes the file layout,
the screens (landing, lobby, play, finish) and the interfaces between them.

- **World**: the game logic still runs on a flat 2D plane (x, y). Three.js draws it
  as the ground plane, so world (x, y) is 3D (x, 0, y). Each cell is 256 world units.
- **Tiles**: one flat quad per artwork. The whole artwork is fitted inside its cell,
  centred, with a small gap around it. Gaps show a dark ground with faint grid lines.
- **Textures**: all images are fetched from `data.ng.ac.uk`, 16 at a time, nearest
  to the car first. Only tiles within `TEX_RADIUS` cells of the car get a GPU
  texture (resized to 512px at most), and textures beyond `TEX_KEEP` are freed.
  Uploading all 2,400 at once would use too much GPU memory. Fog hides the edge.
- **Cars**: a simple box model with turning front wheels and a slight lean in corners,
  one per player. Arcade handling (heading + speed, steering scaled by speed), with
  all the numbers in the `CAR` settings block in `js/game/car.js`. Cars start side
  by side on the tile nearest the centre of all tiles.
- **Camera**: a chase camera sits behind and above the car and swings round after
  it with a short delay. The settings are in the `chase` block in `js/game/camera.js`.

### Multiplayer (`party/server.ts`, `public/js/net/`)

- **Rooms**: each game room is one instance of the `GameRoom` Durable Object, named by
  its 4-character code. Clients connect over WebSocket to
  `/parties/game-room/<CODE>` (PartyServer's `routePartykitRequest` does the routing).
- **Players**: the first player in a room is the host. If the host leaves, the next player
  takes over. Each player gets a colour and a starting slot (up to 6 players).
- **During a game**: each browser sends its car's position about 15 times a second, and
  the server relays it to the others, who smooth it out. Selections are relayed the same way.
  The server keeps no game state beyond the player list, so nothing is stored.
- **Screens** only talk to the `Net` interface in `public/js/net/net.js`. The
  message formats are listed at the top of `public/js/net/partykit.js`.

## Next steps

- Gaps: falling off the edge of a tile, and a jump button to cross between islands.
- Decide whether the drivable surface is the whole cell or only the visible image
  (wide or tall paintings leave empty margins inside their cell).
- Gathering artworks: the "dash to gather" game goal.
- Multiplayer: let players join a game that has already started, and reconnect after
  a dropped connection. Neither works yet.
