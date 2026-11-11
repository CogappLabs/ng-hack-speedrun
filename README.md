# ng-hack-speedrun
Dash to gather artworks. Created for the National Gallery Hack Day November 2026

A web game where you drive a car across a 3D landscape made of National Gallery
artworks, laid flat like floor tiles. Paintings that look similar sit next to each other.
Each game sets a challenge, such as "photograph 10 examples of hats": you have 10 photos,
and you score a point for every one that shows the subject. Play on your own or race up to
9 others: the game ends as soon as anyone fills their film.

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

Open the game in two tabs and choose Multiplayer in both. Create a room in one tab; it
appears in the other tab's list of open rooms, so click it to join. On localhost the game connects to the local server
automatically.

## Deployment

Every push to `main` publishes `public/` to GitHub Pages, using
`.github/workflows/pages.yml`. Commit the `public/layout_*.json` files after rebuilding them,
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

| Keyboard | Controller (Xbox layout) | Action |
|---|---|---|
| ↑ or W | RT (or D-pad ↑) | Accelerate (the triggers are analogue) |
| ↓ or S | LT (or D-pad ↓) | Brake, then reverse |
| ← / → or A / D | Left stick (or D-pad) | Steer (only works while moving) |
| B (hold) | B (hold) | Boost: about 2.5× top speed for crossing the map. The gauge empties in 3 seconds and refills in 6 |
| Scroll wheel | | Move the camera closer to or further from the car |
| Drag | Right stick | Swing the camera around the car (drive to swing it back; the stick swings back when let go) |
| Hover | | Show the artwork's title |
| Space | A | Photograph the artwork under the car (10 photos per game) |
| Z (hold) | Y (hold) | Enlarge the painting preview to fill the screen; let go to shrink it back |
| Esc | Menu | Quit the game and see your results so far |

WASD is matched by key position, so it's ZQSD on an AZERTY keyboard. Any controller with the
browser's "standard" mapping works; browsers only reveal it after a button is pressed on the page.
The menus still need a mouse.

### How a game works

1. **Challenge**: the game picks one of the subjects found in the paintings (hats, horses,
   halos, …) and announces "Photograph 10 examples of …". In multiplayer everyone gets the
   same challenge.
2. **Photograph**: drive around and press Space on paintings you think show the subject.
   Each photographed painting disappears from the map (for every player), so you can't
   take a photo someone else already has. Choose carefully: you only have 10 photos.
3. **End**: the game ends as soon as any player has taken 10 photos.
4. **Score**: the results show everyone's photos, with a tick on each one that shows the
   subject. Your score is the number of ticks, and the highest score wins. Scores stay
   hidden until the end.

Each run starts on a random tile, facing a random direction. In multiplayer, every player
starts somewhere different. The host starts the game for everyone. Other players' cars show
their names, and the HUD shows how many photos each player has taken: you, plus the top 4
other players (with "+ N more" for the rest).

On screen:

- **Top centre**: a preview of the artwork under the car, with its title. It's hidden when
  you're in a gap.
- **Bottom**: a film strip with 10 frames. Press Space for a camera flash, and the artwork
  flies from the preview into the next empty frame. It then disappears from the map (for
  every player in multiplayer), leaving a gap until the next run.
- **Top left**: the challenge, photos taken, scoreboard, controls and the Quit button.
- **Centre**: the challenge when the game starts, and who filled their film when it ends.
- **Top right**: the locator map (top right) shows the whole grid, each artwork in its average colour, with a
dot for every player. Yours is the larger dot with an arrow pointing where you're heading.

## How it works

### Input data

`input/vectors_2d.tsv` has one row per artwork: its object id (`uid`), an image URL
(`image_mid_url`), the IIIF image URL (`image_iiif_url`, used to match subject labels) and
several 2D projections (`clip_*`, `curatorial_*`, `visual_*`, `combined_*`).
The game has one map per projection (visual, curatorial, clip), each at three
difficulties (easy, medium, hard): `public/layout_<map>_<difficulty>.json`, built with
`--type <map>` and a larger `--slack` for harder (bigger, more spread-out) maps. Players
pick the map on the first screen, with an outline of it; in multiplayer the room creator's
map is used. `visual` places artworks that look alike close together. Rows with no image or coordinates are skipped (14 of 2,412).

`input/filtered_subjects.tsv` lists the subjects found in each image (see
"Subject labels" below).

### Layout (`scripts/build_layout.py`)

The projection gives continuous points, and many of them overlap. The script
snaps each artwork to its own cell of a square grid:

1. Scale the points onto a grid with `--slack` cells per artwork (default **3**).
2. Give each artwork a unique cell, keeping the total squared distance moved as
   small as possible (Hungarian algorithm, `scipy.optimize.linear_sum_assignment`).
3. Attach subject labels from `input/filtered_subjects.tsv` (see below).
4. Write `public/layout.json`:
   `{cols, rows, challenges: [{label, name, tiles}], tiles: [{id, acc, title, url, col, row, labels?}]}`.

Using several cells per artwork keeps the outline close to the original scatter
plot and leaves gaps between groups. These gaps are the "islands" you'll jump
between. The slack value controls the trade-off:

| `--slack` | Average move (cells) | Islands | Largest island |
|---|---|---|---|
| 2 | 2.2 | 4 | 2,326 |
| **3** | **1.1** | **58** | **1,491** |
| 4 | 0.76 | 126 | 824 |
| 8 | 0.5 | 465 | 205 |

Islands count side-by-side tiles only, not diagonal ones. These figures were measured on an
earlier export of the data, so the current numbers will differ slightly.

#### Subject labels (challenges)

`input/filtered_subjects.tsv` has one row per subject found in an image, e.g. a hat or a horse
(`label`), with a plural display name (`category`, e.g. "hats"). Subjects are tagged per
*image*, so they're matched to artworks on the image id: the last part of a tile's
`image_iiif_url` in `vectors_2d.tsv` equals the subject's `image_pid`. (The `uid` column is
the artwork's object id, which is a different id.) Each tile gets the sorted list of its
labels, and every label found on at least `--min-tiles` tiles (default 10) becomes a possible
challenge, with `name` set from `category`. Rebuild the layout whenever either file changes.

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
- **Cars**: a safari wagon built from simple boxes: the player's colour with a cream roof,
  roof rack and luggage, bull bar, snorkel and a spare wheel on the back. The front wheels
  turn and the body leans a little in corners. One car per player. Arcade handling (heading + speed, steering scaled by speed), with
  all the numbers in the `CAR` settings block in `js/game/car.js`.
- **Starting positions**: `spawnPoint(seed, slot)` in `js/game/world.js` shuffles the tiles
  with a seeded random number generator and gives each slot its own tile and heading. In
  multiplayer the server sends one random seed when the host starts, so every browser works
  out the same starting tiles without the server needing to know the map. Single player
  uses a fresh random seed each run.
- **Locator map** (`js/game/minimap.js`): two pixels per grid cell, redrawn every frame.
  The grid background is cached and refreshed while images load.
- **Camera**: a chase camera sits behind and above the car and swings round after
  it with a short delay. The settings are in the `chase` block in `js/game/camera.js`.

### Multiplayer (`party/server.ts`, `public/js/net/`)

- **Rooms**: each game room is one instance of the `GameRoom` Durable Object, named by a
  random id. The host gives the room a title (default "<name>'s room"). Clients connect
  over WebSocket to `/parties/game-room/<id>` (PartyServer's `routePartykitRequest` does
  the routing).
- **Open rooms list**: a single `RoomDirectory` Durable Object lists the rooms that can still
  be joined. Each `GameRoom` reports to it over Durable Object RPC whenever its players change,
  and removes itself when the host starts or the last player leaves. The lobby screen
  watches `/parties/room-directory/all` and redraws the list as it changes. Open rooms
  re-announce themselves every 30 seconds, and the directory drops any room it hasn't
  heard from in 75 seconds. That cleans up rooms whose server stopped without saying so,
  e.g. during a redeploy.
- **Players**: the first player in a room is the host, and only the host can start the game. If the host leaves, the next player
  takes over. Each player gets a slot (0–9), which sets their colour and starting tile.
  Rooms hold up to 10 players (`MAX_PLAYERS` in `party/server.ts`).
- **During a game**: each browser sends its car's position about 15 times a second, and
  the server relays it to the others, who smooth it out.
- **Photographing**: Space sends a claim for the artwork to the server. The first claim on
  each artwork wins (others are ignored, as are claims beyond 10 per player). The server then
  tells every player, including the photographer, so the artwork vanishes from every map at
  the same moment. The photographer's film strip animation starts when the confirmation
  arrives. When a player's 10th photo is confirmed, the server sends `end` to everyone.
- **Challenge and scores** need no server support: the challenge is picked from the same random
  seed as the starting tiles, and each browser scores the photos itself from the labels in
  `layout.json`.
- The server keeps no game state beyond the player list and this game's photographed artworks,
  so nothing is stored. With 10
  players that's about 150 messages in and 1,350 out per second per room, which is light
  for one Durable Object.
- **Colours**: `PLAYER_COLORS` in `public/js/net/net.js` spreads 10 hues evenly round the
  colour wheel, starting with the single-player red.
- **Screens** only talk to the `Net` interface in `public/js/net/net.js`. The
  message formats are listed at the top of `public/js/net/partykit.js`.

## Next steps

- Gaps: falling off the edge of a tile, and a jump button to cross between islands.
- Decide whether the drivable surface is the whole cell or only the visible image
  (wide or tall paintings leave empty margins inside their cell).
- Gathering artworks: a goal or time limit for the "dash to gather" game.
- Multiplayer: let players join a game that has already started, and reconnect after
  a dropped connection. Neither works yet.
