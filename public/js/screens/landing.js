// Feature 1: landing page. Choose the game options (../options.js): the map style, its
// difficulty (with an outline of that map), the game mode, then single player or multiplayer.
// The options are stored in ctx.options; in multiplayer they apply to rooms you create.
// The world behind the panel switches to the chosen map and slowly spins while the images load.
import { chase, normaliseOrbit, updateCamera } from '../game/camera.js';
import { progress, world, useMap } from '../game/world.js';
import { MAPS, DIFFICULTIES, MINUTES, saveOptions, optionsRules } from '../options.js';
import { render, esc } from '../ui.js';

const OUTLINE_W = 240, OUTLINE_H = 150;  // CSS pixels

let $, root, ctx;

// One row of toggle buttons: [{ value, label }], with data-opt=<name> on each.
const seg = (name, label, items) => `
  <div class="option" data-option="${name}">
    <span class="option-label">${label}</span>
    <div class="seg" role="group" aria-label="${label}">
      ${items.map(i => `<button data-opt="${name}" data-value="${esc(i.value)}">${esc(i.label)}</button>`).join('')}
    </div>
  </div>`;

// The current map's occupied cells, scaled to fit the outline canvas.
function drawOutline() {
  const canvas = $('.outline');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = OUTLINE_W * dpr;
  canvas.height = OUTLINE_H * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, OUTLINE_W, OUTLINE_H);
  const px = Math.min(OUTLINE_W / world.cols, OUTLINE_H / world.rows);
  const ox = (OUTLINE_W - world.cols * px) / 2, oy = (OUTLINE_H - world.rows * px) / 2;
  g.fillStyle = '#d6dae1';
  for (const t of world.tiles) g.fillRect(ox + t.col * px, oy + t.row * px, px, px);
  $('.map-size').textContent =
    `${world.cols} × ${world.rows} grid · ${world.tiles.length.toLocaleString()} artworks`;
  $('.map-info').classList.remove('loading');
}

// Switch the world to the chosen map, put the car on it and redraw the outline.
async function showMap() {
  const { map, difficulty } = ctx.options;
  $('.map-about').textContent = `${MAPS[map].about} ${DIFFICULTIES[difficulty].about}`;
  const changing = world.map?.map !== map || world.map?.difficulty !== difficulty;
  if (changing) $('.map-info').classList.add('loading');
  let current;
  try {
    current = await useMap(map, difficulty);
  } catch (e) {
    if (!$) return;
    $('.map-size').textContent = e.message;
    $('.map-info').classList.remove('loading');
    return;
  }
  if (!current || !$) return;  // superseded by a newer choice, or we've left the screen
  if (changing) {  // a new map: put the car on one of its tiles
    ctx.newRun();
    updateCamera(ctx.car, 0, true);
  }
  drawOutline();
}

function show() {
  const o = ctx.options;
  root.querySelectorAll('[data-opt]').forEach(b =>
    b.setAttribute('aria-pressed', String(o[b.dataset.opt]) === b.dataset.value));
  $('[data-option="minutes"]').hidden = o.mode !== 'time';
  $('.rules').textContent = optionsRules(o);
}

export default {
  mount(r, context) {
    root = r;
    ctx = context;
    $ = render(root, `
      <div class="panel centre landing">
        <h1>Art Safari</h1>
        <p class="muted">Race across the National Gallery's collection and photograph the paintings that match your challenge.</p>
        <div class="options">
          ${seg('map', 'Map', Object.entries(MAPS).map(([value, m]) => ({ value, label: m.name })))}
          ${seg('difficulty', 'Difficulty', Object.entries(DIFFICULTIES).map(([value, d]) => ({ value, label: d.name })))}
          <figure class="map-info">
            <canvas class="outline" style="width:${OUTLINE_W}px;height:${OUTLINE_H}px" aria-hidden="true"></canvas>
            <figcaption><span class="map-size muted"></span><br><span class="map-about muted"></span></figcaption>
          </figure>
          ${seg('mode', 'Mode', [{ value: 'time', label: 'Time' }, { value: 'challenge', label: 'Challenge' }])}
          ${seg('minutes', 'Time', MINUTES.map(m => ({ value: m, label: `${m} min` })))}
          <p class="muted rules"></p>
        </div>
        <div class="row">
          <button class="primary" data-mode="single">Single player</button>
          <button data-mode="multi">Multiplayer</button>
        </div>
        <p class="muted status"></p>
      </div>`);

    root.querySelectorAll('[data-opt]').forEach(b => {
      b.onclick = () => {
        const name = b.dataset.opt;
        const value = name === 'minutes' ? +b.dataset.value : b.dataset.value;
        ctx.options = { ...ctx.options, [name]: value };
        saveOptions(ctx.options);
        show();
        if (name === 'map' || name === 'difficulty') showMap();
      };
    });
    show();
    showMap();

    const play = async mode => {
      // Make sure the world is the chosen map (it may still be loading).
      const ok = await useMap(ctx.options.map, ctx.options.difficulty).catch(() => false);
      if (!ok || !$) return;
      if (mode === 'single') {
        ctx.session = { mode: 'single', net: null };
        ctx.newRun();
        ctx.go('play');
      } else ctx.go('lobby');
    };
    $('[data-mode="single"]').onclick = () => play('single');
    $('[data-mode="multi"]').onclick = () => play('multi');
    chase.orbitReturn = false;
  },

  update(dt) {
    chase.orbit += dt * 0.12;
    $('.status').textContent = progress.done
      ? `${progress.total.toLocaleString()} artworks`
      : `Loading artworks… ${progress.loaded}/${progress.total}`;
  },

  unmount() {
    $ = null;
    normaliseOrbit();
    chase.orbitReturn = true;
  },
};
