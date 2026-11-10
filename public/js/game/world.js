// The artwork landscape: layout data, one flat tile per artwork, image loading and GPU textures.
import * as THREE from 'three';
import { CELL, INNER } from '../config.js';
import { renderer, scene } from '../scene.js';

const CONCURRENCY = 16;    // parallel image downloads
const TEX_RADIUS = 22;     // cells: tiles closer than this to the focus point get a GPU texture
const TEX_KEEP = 28;       // cells: textures further than this are freed
const TEX_PER_FRAME = 8;   // texture uploads allowed per frame (keeps frame times smooth)
const TEX_MAX_PX = 512;    // longest side of an uploaded texture

// tiles: [{id, acc, title, url, col, row, mesh, img?}]. start: the tile nearest the centre.
export const world = { cols: 0, rows: 0, tiles: [], byCell: new Map(), start: null };
export const progress = { loaded: 0, total: 0, done: false };

export const tileAt = (x, y) => world.byCell.get(Math.floor(x / CELL) + ',' + Math.floor(y / CELL));
export const tileCentre = t => ({ x: (t.col + 0.5) * CELL, y: (t.row + 0.5) * CELL });

const tileGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const placeholderMat = new THREE.MeshBasicMaterial({ color: 0x3a3a3a });
const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());  // keeps low-angle tiles sharp

export async function loadWorld(url = 'layout.json') {
  const layout = await (await fetch(url)).json();
  world.cols = layout.cols;
  world.rows = layout.rows;
  world.tiles = layout.tiles;
  for (const t of world.tiles) world.byCell.set(t.col + ',' + t.row, t);
  progress.total = world.tiles.length;

  const mc = world.tiles.reduce((s, t) => s + t.col, 0) / world.tiles.length;
  const mr = world.tiles.reduce((s, t) => s + t.row, 0) / world.tiles.length;
  world.start = world.tiles.reduce((best, t) =>
    (t.col - mc) ** 2 + (t.row - mr) ** 2 < (best.col - mc) ** 2 + (best.row - mr) ** 2 ? t : best);

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
      try { await img.decode(); t.img = img; fitTile(t); } catch { t.failed = true; }
      progress.loaded++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  progress.done = true;
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
    if (t.tex && d > TEX_KEEP) {
      t.mesh.material = placeholderMat;
      t.mat.dispose(); t.tex.dispose();
      t.tex = t.mat = null;
    } else if (!t.tex && d < TEX_RADIUS) want.push([d, t]);
  }
  want.sort((a, b) => a[0] - b[0]);
  for (const [, t] of want) {
    if (!budget--) break;
    t.tex = makeTexture(t.img);
    t.mat = new THREE.MeshBasicMaterial({ map: t.tex });
    t.mesh.material = t.mat;
  }
}
