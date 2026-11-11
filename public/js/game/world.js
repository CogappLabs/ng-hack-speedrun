// The artwork landscape: layout data, one flat tile per artwork, image loading and GPU textures.
import * as THREE from 'three';
import { CELL, INNER } from '../config.js';
import { renderer, scene } from '../scene.js';

const CONCURRENCY = 16;    // parallel image downloads
const TEX_RADIUS = 22;     // cells: tiles closer than this to the focus point get a GPU texture
const TEX_KEEP = 28;       // cells: textures further than this are freed
const TEX_PER_FRAME = 8;   // texture uploads allowed per frame (keeps frame times smooth)
const TEX_MAX_PX = 512;    // longest side of an uploaded texture

// tiles: [{id, acc, title, url, col, row, labels?, mesh, img?, avg?, removed?}]. labels are the
// subjects found in the artwork (e.g. ["hat", "horse"]). avg is the image's average
// colour as a CSS string, once loaded (used by the locator map). removed is set once the artwork
// has been collected this run. version goes up whenever tiles are removed or restored.
// challenges: [{ label, name, tiles }], e.g. { label: 'hat', name: 'hats', tiles: 394 }.
export const world = { cols: 0, rows: 0, tiles: [], challenges: [], byCell: new Map(), byId: new Map(), version: 0 };
export const progress = { loaded: 0, total: 0, done: false };

// The tile at a world position, or undefined for a gap (including a collected artwork's cell).
export function tileAt(x, y) {
  const t = world.byCell.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));
  return t && !t.removed ? t : undefined;
}

// Take a collected artwork off the map: it leaves a gap until the next run.
export function removeTile(t) {
  if (t.removed) return;
  t.removed = true;
  t.mesh.visible = false;
  world.version++;
}

// Put every collected artwork back, ready for a new run.
export function restoreTiles() {
  let changed = false;
  for (const t of world.tiles) {
    if (!t.removed) continue;
    t.removed = false;
    t.mesh.visible = true;
    changed = true;
  }
  if (changed) world.version++;
}
export const tileCentre = t => ({ x: (t.col + 0.5) * CELL, y: (t.row + 0.5) * CELL });

// Where a player starts: a random tile and heading picked from `seed`, with each slot on a
// different tile. Every client calls this with the same seed, so they all agree on where
// everyone starts without sending positions.
export function spawnPoint(seed, slot = 0) {
  const rand = mulberry32(seed);
  // Partial Fisher-Yates shuffle of tile indices, just far enough to reach this slot.
  const idx = world.tiles.map((_, i) => i);
  for (let i = 0; i <= slot; i++) {
    const j = i + Math.floor(rand() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const t = world.tiles[idx[slot]];
  return { ...tileCentre(t), heading: Math.floor(rand() * 4) * Math.PI / 2 - Math.PI };
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

// The run's challenge (which subject to photograph), picked from `seed` so every player in a
// multiplayer game gets the same one. Uses a different stream from spawnPoint's.
export function challengeFor(seed) {
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  return world.challenges[Math.floor(rand() * world.challenges.length)] ?? null;
}

// Does this tile show the challenge's subject?
export const tileMatches = (tile, challenge) => !!challenge && !!tile?.labels?.includes(challenge.label);

// Small seeded random number generator (returns floats in [0, 1)).
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tileGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const placeholderMat = new THREE.MeshBasicMaterial({ color: 0x3a3a3a });
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());  // keeps low-angle tiles sharp

export async function loadWorld(url = 'layout.json') {
  // Always check for a newer layout (a cheap 304 when unchanged). A stale cached copy would give
  // this player a different map, starting tiles and challenge from everyone else in a game.
  const layout = await (await fetch(url, { cache: 'no-cache' })).json();
  world.cols = layout.cols;
  world.rows = layout.rows;
  world.tiles = layout.tiles;
  world.challenges = layout.challenges ?? [];
  for (const t of world.tiles) {
    world.byCell.set(t.col + ',' + t.row, t);
    world.byId.set(t.id, t);
  }
  progress.total = world.tiles.length;
  buildMeshes();
}

function buildMeshes() {
  const group = new THREE.Group();
  for (const t of world.tiles) {
    const m = new THREE.Mesh(tileGeo, placeholderMat);
    const c = tileCentre(t);
    m.position.set(c.x, 0, c.y);
    m.scale.set(INNER, 1, INNER);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    t.mesh = m;
    group.add(m);
  }
  scene.add(group);

  // Dark ground under the gaps, with faint cell lines so you can sense speed off-road.
  const W = world.cols * CELL, H = world.rows * CELL;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + CELL * 40, H + CELL * 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x0d0f13 }));
  ground.position.set(W / 2, -2, H / 2);
  scene.add(ground);
  const size = Math.max(world.cols, world.rows);
  const grid = new THREE.GridHelper(size * CELL, size, 0x262b35, 0x262b35);
  grid.position.set(size * CELL / 2, -1, size * CELL / 2);
  scene.add(grid);
}

// Fit the whole artwork inside its square cell, centred (letterboxed).
function fitTile(t) {
  const s = Math.min(INNER / t.img.width, INNER / t.img.height);
  t.mesh.scale.set(t.img.width * s, 1, t.img.height * s);
  t.mesh.updateMatrix();
}

// Download every image with bounded concurrency, nearest to `focus` ({x, y}) first.
export async function loadImages(focus) {
  const dist = t => (t.col * CELL - focus.x) ** 2 + (t.row * CELL - focus.y) ** 2;
  const queue = [...world.tiles].sort((p, q) => dist(p) - dist(q));
  async function worker() {
    while (queue.length) {
      const t = queue.shift();
      const img = new Image();
      img.crossOrigin = 'anonymous';  // needed for WebGL textures (server sends CORS headers)
      img.decoding = 'async';
      img.src = t.url;
      try { await img.decode(); t.img = img; fitTile(t); t.avg = averageColor(img); } catch { t.failed = true; }
      progress.loaded++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  progress.done = true;
}

// Average colour of an image, by letting the browser scale it down to one pixel.
const avgCtx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
  .getContext('2d', { willReadFrequently: true });
function averageColor(img) {
  avgCtx.drawImage(img, 0, 0, 1, 1);
  const [r, g, b] = avgCtx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r},${g},${b})`;
}

function makeTexture(img) {
  const s = Math.min(1, TEX_MAX_PX / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

// Call once per frame. Only tiles near (x, y) hold a texture; all 2,400 at once would use too much GPU memory.
export function updateTextures(x, y) {
  const cc = x / CELL, cr = y / CELL;
  let budget = TEX_PER_FRAME;
  const want = [];
  for (const t of world.tiles) {
    if (!t.img) continue;
    const d = Math.hypot(t.col + 0.5 - cc, t.row + 0.5 - cr);
    if (t.tex && (d > TEX_KEEP || t.removed)) {
      t.mesh.material = placeholderMat;
      t.mat.dispose(); t.tex.dispose();
      t.tex = t.mat = null;
    } else if (!t.tex && !t.removed && d < TEX_RADIUS) want.push([d, t]);
  }
  want.sort((a, b) => a[0] - b[0]);
  for (const [, t] of want) {
    if (!budget--) break;
    t.tex = makeTexture(t.img);
    t.mat = new THREE.MeshBasicMaterial({ map: t.tex });
    t.mesh.material = t.mat;
  }
}
