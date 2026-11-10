# ng-hack-speedrun
Dash to gather artworks. Created for the National Gallery Hack Day November 2026

A web game where you drive a car across a 3D landscape made of National Gallery
artworks, laid flat like floor tiles. Paintings that look similar sit next to each other, so you drive
between neighbouring works and (soon) jump across the gaps between groups.

## Quick start

Requires Python 3 and [uv](https://docs.astral.sh/uv/).

```sh
# 1. Build the tile layout (only needed when the input data or layout settings change)
uv run scripts/build_layout.py

# 2. Serve the game
cd public && python3 -m http.server 8765
```

Open http://localhost:8765/.

## Deployment

Every push to `main` publishes `public/` to GitHub Pages, using
`.github/workflows/pages.yml`. Commit `public/layout.json` after rebuilding it,
because the workflow doesn't run the build script. You can also run the
workflow by hand from the Actions tab.

One-time setup: in the repository's **Settings → Pages**, set **Source** to
**GitHub Actions**.

## Controls

| Input | Action |
|---|---|
| ↑ | Accelerate |
| ↓ | Brake, then reverse |
| ← / → | Steer (only works while moving) |
| Scroll wheel | Move the camera closer to or further from the car |
| Drag | Swing the camera around the car (press any arrow key to swing it back) |
| Hover | Show the artwork's title |

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

### Game (`public/index.html`)

A single page using [Three.js](https://threejs.org/) (0.170.0, loaded from jsDelivr
through an import map). There is no build step.

- **World**: the game logic still runs on a flat 2D plane (x, y). Three.js draws it
  as the ground plane, so world (x, y) is 3D (x, 0, y). Each cell is 256 world units.
- **Tiles**: one flat quad per artwork. The whole artwork is fitted inside its cell,
  centred, with a small gap around it. Gaps show a dark ground with faint grid lines.
- **Textures**: all images are fetched from `data.ng.ac.uk`, 16 at a time, nearest
  to the car first. Only tiles within `TEX_RADIUS` cells of the car get a GPU
  texture (resized to 512px at most), and textures beyond `TEX_KEEP` are freed.
  Uploading all 2,400 at once would use too much GPU memory. Fog hides the edge.
- **Car**: a simple box model with turning front wheels and a slight lean in corners.
  The handling is unchanged: arcade style (heading + speed, steering scaled by
  speed). All the handling numbers are in the `CAR` settings block. The car
  starts on the tile nearest the centre of all tiles.
- **Camera**: a chase camera sits behind and above the car and swings round after
  it with a short delay. The settings are in the `chase` block.

## Next steps

- Gaps: falling off the edge of a tile, and a jump button to cross between islands.
- Decide whether the drivable surface is the whole cell or only the visible image
  (wide or tall paintings leave empty margins inside their cell).
- Gathering artworks: the "dash to gather" game goal.
