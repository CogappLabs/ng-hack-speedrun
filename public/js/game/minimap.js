// Locator map: the whole grid in miniature (each artwork drawn in its average colour),
// with a dot for every player. The local player is drawn last, larger, with a heading arrow.
import { CELL } from '../config.js';
import { world, progress } from './world.js';

const PX = 2;                  // map pixels per grid cell (CSS pixels)
const MARGIN = 6;              // space round the grid so dots at the edge aren't cut off
const REBUILD_MS = 500;        // while images load, redraw the background at most this often
const hex = n => '#' + n.toString(16).padStart(6, '0');

export function createMinimap() {
  const w = world.cols * PX + MARGIN * 2, h = world.rows * PX + MARGIN * 2;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const canvas = document.createElement('canvas');
  canvas.className = 'minimap';
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.aspectRatio = `${w} / ${h}`;
  const g = canvas.getContext('2d');

  // The tiles are drawn once into a background canvas, then again as images finish loading.
  const base = document.createElement('canvas');
  base.width = canvas.width;
  base.height = canvas.height;
  const bg = base.getContext('2d');
  let baseLoaded = -1, baseAt = 0;

  function drawBase() {
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg.clearRect(0, 0, w, h);
    for (const t of world.tiles) {
      bg.fillStyle = t.avg ?? '#555';
      bg.fillRect(MARGIN + t.col * PX, MARGIN + t.row * PX, PX, PX);
    }
    baseLoaded = progress.loaded;
    baseAt = performance.now();
  }

  function dot(x, y, r, color, outline) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = outline;
    g.stroke();
  }

  return {
    canvas,

    // players: [{ x, y, heading, color, self }] in world units; color is a hex number.
    draw(players) {
      const now = performance.now();
      if (progress.loaded !== baseLoaded && (progress.done || now - baseAt > REBUILD_MS)) drawBase();

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(base, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      const toMap = p => [MARGIN + p.x / CELL * PX, MARGIN + p.y / CELL * PX];
      for (const p of players) {
        if (p.self) continue;
        const [x, y] = toMap(p);
        dot(x, y, 3, hex(p.color), 'rgba(0,0,0,0.8)');
      }
      const me = players.find(p => p.self);
      if (me) {
        const [x, y] = toMap(me);
        // Heading arrow, then the dot on top.
        g.save();
        g.translate(x, y);
        g.rotate(me.heading);
        g.beginPath();
        g.moveTo(12, 0);
        g.lineTo(2, -5);
        g.lineTo(2, 5);
        g.closePath();
        g.fillStyle = '#fff';
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = '#000';
        g.stroke();
        g.restore();
        dot(x, y, 4.5, hex(me.color), '#fff');
      }
    },
  };
}
