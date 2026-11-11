// Feature 3: gameplay. Drive, photograph artworks, and in multiplayer see the other players.
//
// The challenge (ctx.challenge) is announced at the start: photograph COLLECTION_SIZE artworks
// showing a subject, e.g. hats. Space photographs the artwork under the car: it flies from the
// preview (top centre) into the next empty frame of the film strip (bottom) and disappears from
// the map. In multiplayer the server decides who gets each artwork (first claim wins) and tells
// everyone, so it disappears from every player's map at once.
//
// How the game ends depends on the run's options (ctx.runOptions, see ../options.js):
// - challenge mode: as soon as anyone fills their film.
// - time mode: when the clock runs out (in multiplayer the server's 'end' event decides), or
//   once every film is full.
// Only then is the score revealed: how many of each player's photos show the challenge subject
// (see the finish screen).
import { stepCar, createCar, removeCar, placeCar, syncCarModel, setCarLabel, setCarColor } from '../game/car.js';
import { chase, groundPointAt, isDragging } from '../game/camera.js';
import { driveInput, lookInput, isDriveKey, padConnected, setDrivingEnabled, onKey, onKeyUp } from '../game/input.js';
import { tileAt, progress, spawnPoint, world, removeTile, tileMatches } from '../game/world.js';
import { createMinimap } from '../game/minimap.js';
import { createPreview } from '../hud/preview.js';
import { createFilmstrip } from '../hud/filmstrip.js';
import { COLLECTION_SIZE } from '../config.js';
import { cssColor, selfPlayer, PLAYER_COLORS } from '../net/net.js';
import { minutesText } from '../options.js';
import { canvas } from '../scene.js';
import { render, esc } from '../ui.js';

const SEND_HZ = 15;        // how often we send our car's position
const IDLE_SEND_S = 1;     // when not moving, still send this often so late messages settle
const SMOOTHING = 12;      // how fast remote cars catch up with their latest position (per second)
const SCOREBOARD_OTHERS = 4; // other players listed in the HUD (most photos first); the rest are summarised
const ANNOUNCE_MS = 4000;  // how long the challenge banner stays up at the start
const END_DELAY_MS = 1800; // pause on "film full" before the results, so the last photo can land
const HURRY_S = 10;
const LOOK_RATE = 2.5;     // rad/s the camera swings round at full right-stick
const KEYS_HELP = 'Arrow keys or WASD to drive · hold B to boost · Space to photograph · hold Z to enlarge the painting · scroll to zoom · drag to look around · Esc to quit';
const PAD_HELP = 'Controller: RT/LT to drive and brake · left stick to steer · hold B to boost · A to photograph · hold Y to enlarge the painting · right stick to look around · Menu to quit';
let looking = false;       // the right stick is swinging the camera        // the clock turns red for the last few seconds

let $, ctx, net, off = [], minimap, preview, filmstrip;
let remotes = new Map();   // player id → { player, car, target, picks: tileId[] }
let departed = [];         // players who left mid-game: { player, picks }, kept for the results
let sendTimer = 0, idleTimer = 0, lastSent = '';
let pending = new Set();   // tile ids we've asked the server for and are waiting to hear about
let ending = null;         // set once the game is over: { by, reason, players }
let options;               // this run's { mode, minutes }
let deadline = 0;          // time mode: performance.now() when the clock runs out
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

// Go to the results. endedBy: who filled their film first (null if not that, e.g. we quit
// early). reason: 'full' | 'time' | 'all-full' | 'quit' (see the finish screen).
function finishRun(endedBy = null, reason = 'quit', players = results()) {
  ctx.go('finish', { mode: ctx.session.mode, options, challenge: ctx.challenge, endedBy, reason, players });
}

// The game is over: stop driving, say why, then show the results.
// reason 'full': player byId (null for us in single player) filled their film;
// 'time': the clock ran out; 'all-full': everyone's film is full (time mode).
function endGame(reason, byId = null) {
  if (ending) return;
  let by = null, title;
  if (reason === 'full') {
    const self = !net || byId === net.selfId;
    by = self ? 'You' : (remotes.get(byId)?.player.name ?? 'Another player');
    title = self ? 'Your film is full!' : `${by} filled their film!`;
  } else {
    title = reason === 'time' ? 'Time’s up!' : 'Everyone’s film is full!';
  }
  // Take the results now: players may leave while the banner is showing.
  ending = { by, reason, players: results() };
  setDrivingEnabled(false);
  showClock();
  banner(title, 'Developing the photos…');
  timers.push(setTimeout(() => finishRun(by, reason, ending.players), END_DELAY_MS));
}

// Boost tank gauge in the HUD.
function showBoost() {
  const el = $('.boost');
  el.querySelector('.boost-fill').style.width = `${Math.round(ctx.car.boost * 100)}%`;
  el.classList.toggle('on', ctx.car.boosting);
  el.classList.toggle('empty', ctx.car.boost <= 0);
}

// --- Time mode clock ---------------------------------------------------------------

const secondsLeft = () => Math.max(0, Math.ceil((deadline - performance.now()) / 1000));

function showClock() {
  if (options.mode !== 'time') return;
  const s = ending?.reason === 'time' ? 0 : secondsLeft();
  const el = $('.clock');
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  el.classList.toggle('hurry', s <= HURRY_S);
}

function tickClock() {
  if (options.mode !== 'time' || ending) return;
  showClock();
  // Single player ends here; in multiplayer the server's 'end' event ends the game for everyone.
  if (!net && secondsLeft() <= 0) endGame('time');
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
  if (!ctx.inventory.full) return;
  if (!net) endGame('full');  // in multiplayer the server sends 'end'
  else if (options.mode === 'time') banner('Your film is full!', 'Waiting for the others to finish…');
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
    options = ctx.runOptions;
    setCarColor(ctx.car, selfPlayer(net)?.color ?? PLAYER_COLORS[0]);
    $ = render(root, `
      <div class="panel hud">
        <div class="status"></div>
        <div class="clock" hidden></div>
        <div class="goal"></div>
        <div class="inv"></div>
        <div class="boost"><span>Boost</span><span class="boost-bar"><span class="boost-fill"></span></span></div>
        <div class="scores"></div>
        <div class="net-error"></div>
        <div class="muted help"></div>
        <button class="finish-btn">Quit game</button>
      </div>
      <div class="panel banner" hidden><div class="banner-title"></div><div class="banner-sub muted"></div></div>
      <div class="flash"></div>
      <div class="tip"></div>`);
    $('.finish-btn').onclick = () => finishRun();
    const goal = ctx.challenge?.name ?? 'artworks';
    if (options.mode === 'time') {
      deadline = performance.now() + options.minutes * 60_000;
      $('.clock').hidden = false;
      showClock();
      $('.goal').textContent = `Goal: photograph ${goal}`;
      banner(`Photograph as many ${goal} as you can`,
        `You have ${minutesText(options.minutes)}, and your film holds ${COLLECTION_SIZE} photos`, ANNOUNCE_MS);
    } else {
      $('.goal').textContent = `Goal: photograph ${COLLECTION_SIZE} ${goal}`;
      banner(`Photograph ${COLLECTION_SIZE} examples of ${goal}`,
        net ? 'The first player to fill their film ends the game' : `Your film holds ${COLLECTION_SIZE} photos, so choose carefully`, ANNOUNCE_MS);
    }
    minimap = createMinimap();
    preview = createPreview();
    filmstrip = createFilmstrip(COLLECTION_SIZE);
    filmstrip.set(ctx.inventory.items);
    root.append(minimap.canvas, preview.el, filmstrip.el);

    const showInventory = items => {
      $('.inv').textContent = `Photographed: ${items.length}/${COLLECTION_SIZE}`;
      showScores();
    };

    const showHelp = () => { $('.help').textContent = padConnected() ? PAD_HELP : KEYS_HELP; };
    showHelp();
    looking = false;
    setDrivingEnabled(true);
    addEventListener('gamepadconnected', showHelp);
    addEventListener('gamepaddisconnected', showHelp);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', hideTip);
    off = [
      () => canvas.removeEventListener('pointermove', onPointerMove),
      () => canvas.removeEventListener('pointerleave', hideTip),
      () => removeEventListener('gamepadconnected', showHelp),
      () => removeEventListener('gamepaddisconnected', showHelp),
      ctx.inventory.onChange(showInventory),
      onKey(e => {
        if (isDriveKey(e)) chase.orbitReturn = true;
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
        net.on('end', ({ id, reason }) => endGame(reason, id)),
        net.on('error', msg => { $('.net-error').textContent = msg; }),
      );
      syncPlayers(net.players);
    }
    showInventory(ctx.inventory.items);
  },

  update(dt) {
    stepCar(ctx.car, driveInput(), dt);  // input is off once the game ends, so the car coasts to a stop
    tickClock();
    showBoost();
    // Right stick: swing the camera round the car, and back behind it when let go.
    const look = lookInput();
    if (look.x) {
      chase.orbit += look.x * LOOK_RATE * dt;
      chase.orbitReturn = false;
      looking = true;
    } else if (looking) {
      chase.orbitReturn = true;
      looking = false;
    }
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
