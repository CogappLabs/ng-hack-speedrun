// Feature 3: gameplay. Drive, photograph artworks, and in multiplayer see the other players.
//
// The challenge (ctx.challenge) is announced at the start: photograph COLLECTION_SIZE artworks
// showing a subject, e.g. hats. Space photographs the artwork under the car: it flies from the
// preview (top centre) into the next empty frame of the film strip (bottom) and disappears from
// the map. In multiplayer the server decides who gets each artwork (first claim wins) and tells
// everyone, so it disappears from every player's map at once.
//
// The game ends as soon as anyone fills their film. Only then is the score revealed: how many
// of each player's photos show the challenge subject (see the finish screen).
import { stepCar, createCar, removeCar, placeCar, syncCarModel, setCarLabel, setCarColor } from '../game/car.js';
import { chase, groundPointAt, isDragging } from '../game/camera.js';
import { driveInput, setDrivingEnabled, onKey, onKeyUp } from '../game/input.js';
import { tileAt, progress, spawnPoint, world, removeTile, tileMatches } from '../game/world.js';
import { createMinimap } from '../game/minimap.js';
import { createPreview } from '../hud/preview.js';
import { createFilmstrip } from '../hud/filmstrip.js';
import { COLLECTION_SIZE } from '../config.js';
import { cssColor, selfPlayer, PLAYER_COLORS } from '../net/net.js';
import { canvas } from '../scene.js';
import { render, esc } from '../ui.js';

const SEND_HZ = 15;        // how often we send our car's position
const IDLE_SEND_S = 1;     // when not moving, still send this often so late messages settle
const SMOOTHING = 12;      // how fast remote cars catch up with their latest position (per second)
const SCOREBOARD_OTHERS = 4; // other players listed in the HUD (most photos first); the rest are summarised
const ANNOUNCE_MS = 4000;  // how long the challenge banner stays up at the start
const END_DELAY_MS = 1800; // pause on "film full" before the results, so the last photo can land

let $, ctx, net, off = [], minimap, preview, filmstrip;
let remotes = new Map();   // player id → { player, car, target, picks: tileId[] }
let departed = [];         // players who left mid-game: { player, picks }, kept for the results
let sendTimer = 0, idleTimer = 0, lastSent = '';
let pending = new Set();   // tile ids we've asked the server for and are waiting to hear about
let ending = null;         // set once the game is over: { by: player name or 'You' }
let timers = [];

const photo = t => ({ id: t.id, acc: t.acc, title: t.title, url: t.url, match: tileMatches(t, ctx.challenge) });

// Everyone's photos and scores, including players who have left.
function results() {
  const me = selfPlayer(net);
  const others = [...remotes.values(), ...departed];
  const players = [
    {
      name: me?.name ?? 'You', color: me?.color ?? PLAYER_COLORS[0], self: true,
      photos: ctx.inventory.items.map(i => photo(world.byId.get(i.id) ?? i)),
    },
    ...others.map(r => ({
      name: r.player.name, color: r.player.color, self: false,
      photos: r.picks.map(id => world.byId.get(id)).filter(Boolean).map(photo),
    })),
  ];
  for (const p of players) p.score = p.photos.filter(x => x.match).length;
  return players;
}

// Go to the results. endedBy: who filled their film (null if the player quit early).
function finishRun(endedBy = null, players = results()) {
  ctx.go('finish', { mode: ctx.session.mode, challenge: ctx.challenge, endedBy, players });
}

// Someone filled their film: stop driving, say so, then show the results.
function endGame(byId) {
  if (ending) return;
  const self = !net || byId === net.selfId;
  const name = self ? 'You' : (remotes.get(byId)?.player.name ?? 'Another player');
  // Take the results now: players may leave while the banner is showing.
  ending = { by: name, players: results() };
  setDrivingEnabled(false);
  banner(self ? 'Your film is full!' : `${name} filled their film!`, 'Developing the photos…');
  timers.push(setTimeout(() => finishRun(name, ending.players), END_DELAY_MS));
}

// Big message in the middle of the screen. Stays up until replaced unless ms is given.
function banner(title, sub = '', ms = 0) {
  const el = $('.banner');
  el.querySelector('.banner-title').textContent = title;
  el.querySelector('.banner-sub').textContent = sub;
  el.hidden = false;
  el.classList.remove('fade');
  if (ms) timers.push(setTimeout(() => el.classList.add('fade'), ms));
}

function flash() {
  const el = $('.flash');
  el.classList.remove('go');
  void el.offsetWidth;  // restart the animation
  el.classList.add('go');
}

function onPointerMove(e) {
  const p = !isDragging() && groundPointAt(e.clientX, e.clientY);
  const t = p && tileAt(p.x, p.y);
  const tip = $('.tip');
  if (t) {
    tip.style.display = 'block';
    tip.style.left = e.clientX + 14 + 'px';
    tip.style.top = e.clientY + 14 + 'px';
    tip.textContent = `${t.title} (${t.acc})`;
  } else tip.style.display = 'none';
}
const hideTip = () => { $('.tip').style.display = 'none'; };

// --- Collecting ------------------------------------------------------------------------

// Space pressed: try to photograph the artwork under the car.
function collect() {
  const t = tileAt(ctx.car.x, ctx.car.y);
  if (ending || !t || ctx.inventory.full || pending.has(t.id)) return;
  if (net) {
    pending.add(t.id);
    net.selectTile(t.id);  // the server answers with 'selected' if we got it first
  } else {
    collected(t);
  }
}

// We've got the artwork: add it to the inventory, fly it into the film strip, take it off the map.
function collected(t) {
  const index = ctx.inventory.size;
  if (!ctx.inventory.add(t)) return;
  flash();
  filmstrip.add(ctx.inventory.items[index], index, preview.img);  // before removeTile hides the preview
  removeTile(t);
  if (!net && ctx.inventory.full) endGame(null);  // in multiplayer the server sends 'end'
}

function onSelected({ id, tileId }) {
  pending.delete(tileId);
  const t = world.byId.get(tileId);
  if (!t) return;
  if (id === net.selfId) {
    collected(t);
    return;
  }
  removeTile(t);
  const r = remotes.get(id);
  if (r && !r.picks.includes(tileId)) {
    r.picks.push(tileId);
    showScores();
  }
}

function previewHint(t) {
  if (ctx.inventory.full) return 'Your film is full';
  if (pending.has(t.id)) return 'Taking photo…';
  return 'Press Space to photograph';
}

// --- Multiplayer ---------------------------------------------------------------------

// Add cars for new players and remove cars for players who left.
function syncPlayers(players) {
  for (const p of players) {
    if (p.id === net.selfId) continue;
    let r = remotes.get(p.id);
    if (!r) {
      const car = createCar({ color: p.color });
      const s = spawnPoint(net.seed, p.slot);
      placeCar(car, s.x, s.y, s.heading);
      r = { player: p, car, target: null, picks: [] };
      remotes.set(p.id, r);
    }
    if (r.player.name !== p.name || !r.car.label) setCarLabel(r.car, p.name);
    r.player = p;
  }
  for (const [id, r] of remotes) {
    if (!players.some(p => p.id === id)) {
      removeCar(r.car);
      remotes.delete(id);
      if (r.picks.length) departed.push({ player: r.player, picks: r.picks });
    }
  }
  showScores();
}

function showScores() {
  if (!net) return;
  const me = selfPlayer(net);
  const others = [...remotes.values()].sort((a, b) => b.picks.length - a.picks.length);
  const shown = others.slice(0, SCOREBOARD_OTHERS);
  const hidden = others.length - shown.length;
  const rows = [
    me && `<span style="color:${cssColor(me.color)}">●</span> You: ${ctx.inventory.size}`,
    ...shown.map(r =>
      `<span style="color:${cssColor(r.player.color)}">●</span> ${esc(r.player.name)}: ${r.picks.length}`),
    hidden > 0 && `<span class="muted">+ ${hidden} more player${hidden === 1 ? '' : 's'}</span>`,
  ].filter(Boolean);
  $('.scores').innerHTML = rows.join('<br>');
}

function updateRemotes(dt) {
  const k = 1 - Math.exp(-dt * SMOOTHING);
  for (const { car, target } of remotes.values()) {
    if (target) {
      car.x += (target.x - car.x) * k;
      car.y += (target.y - car.y) * k;
      const d = target.heading - car.heading;
      car.heading += Math.atan2(Math.sin(d), Math.cos(d)) * k;
      car.speed = target.speed;
      car.steer = target.steer;
    }
    syncCarModel(car, dt);
  }
}

function sendOwnState(dt) {
  sendTimer += dt;
  idleTimer += dt;
  if (sendTimer < 1 / SEND_HZ) return;
  sendTimer = 0;
  const { x, y, heading, speed, steer } = ctx.car;
  const key = `${Math.round(x)},${Math.round(y)},${heading.toFixed(3)},${Math.round(speed)},${steer}`;
  if (key === lastSent && idleTimer < IDLE_SEND_S) return;
  lastSent = key;
  idleTimer = 0;
  net.sendState({ x, y, heading, speed, steer });
}

// --- Screen ------------------------------------------------------------------------

export default {
  mount(root, context) {
    ctx = context;
    net = ctx.session.mode === 'multi' ? ctx.session.net : null;
    pending = new Set();
    ending = null;
    departed = [];
    setCarColor(ctx.car, selfPlayer(net)?.color ?? PLAYER_COLORS[0]);
    $ = render(root, `
      <div class="panel hud">
        <div class="status"></div>
        <div class="goal"></div>
        <div class="inv"></div>
        <div class="scores"></div>
        <div class="net-error"></div>
        <div class="muted">Arrow keys to drive · Space to photograph · hold Z to enlarge the painting · scroll to zoom · drag to look around · Esc to quit</div>
        <button class="finish-btn">Quit game</button>
      </div>
      <div class="panel banner" hidden><div class="banner-title"></div><div class="banner-sub muted"></div></div>
      <div class="flash"></div>
      <div class="tip"></div>`);
    $('.finish-btn').onclick = () => finishRun();
    const goal = ctx.challenge?.name ?? 'artworks';
    $('.goal').textContent = `Goal: photograph ${COLLECTION_SIZE} ${goal}`;
    banner(`Photograph ${COLLECTION_SIZE} examples of ${goal}`,
      net ? 'The first player to fill their film ends the game' : 'Your film holds 10 photos, so choose carefully', ANNOUNCE_MS);
    minimap = createMinimap();
    preview = createPreview();
    filmstrip = createFilmstrip(COLLECTION_SIZE);
    filmstrip.set(ctx.inventory.items);
    root.append(minimap.canvas, preview.el, filmstrip.el);

    const showInventory = items => {
      $('.inv').textContent = `Photographed: ${items.length}/${COLLECTION_SIZE}`;
      showScores();
    };

    setDrivingEnabled(true);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', hideTip);
    off = [
      () => canvas.removeEventListener('pointermove', onPointerMove),
      () => canvas.removeEventListener('pointerleave', hideTip),
      ctx.inventory.onChange(showInventory),
      onKey(e => {
        if (e.key.startsWith('Arrow')) chase.orbitReturn = true;
        if (e.key === 'Escape' && !ending) finishRun();
        if (e.key === 'z' || e.key === 'Z') preview.zoom(true);
        if (e.key === ' ') {
          e.preventDefault();
          if (!e.repeat) collect();
        }
      }),
      onKeyUp(e => { if (e.key === null || e.key === 'z' || e.key === 'Z') preview.zoom(false); }),
    ];

    if (net) {
      sendTimer = idleTimer = 0;
      lastSent = '';
      off.push(
        net.on('players', syncPlayers),
        net.on('state', s => { const r = remotes.get(s.id); if (r) r.target = s; }),
        net.on('selected', onSelected),
        net.on('end', ({ id }) => endGame(id)),
        net.on('error', msg => { $('.net-error').textContent = msg; }),
      );
      syncPlayers(net.players);
    }
    showInventory(ctx.inventory.items);
  },

  update(dt) {
    stepCar(ctx.car, driveInput(), dt);  // input is off once the game ends, so the car coasts to a stop
    if (net) {
      sendOwnState(dt);
      updateRemotes(dt);
    }
    const t = tileAt(ctx.car.x, ctx.car.y);
    preview.show(t, t && previewHint(t));
    $('.status').textContent = progress.done ? '' : `Loading artworks… ${progress.loaded}/${progress.total}`;
    minimap.draw([
      { ...ctx.car, color: selfPlayer(net)?.color ?? PLAYER_COLORS[0], self: true },
      ...[...remotes.values()].map(r => ({ x: r.car.x, y: r.car.y, heading: r.car.heading, color: r.player.color })),
    ]);
  },

  unmount() {
    timers.forEach(clearTimeout);
    timers = [];
    setDrivingEnabled(false);
    off.forEach(f => f());
    off = [];
    for (const r of remotes.values()) removeCar(r.car);
    remotes = new Map();
    ctx.car.speed = 0;
    ctx.car.steer = 0;
    if (net) net.sendState(ctx.car);  // so the others see us stop
  },
};
