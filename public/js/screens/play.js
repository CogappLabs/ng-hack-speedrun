// Feature 3: gameplay. Drive, select artworks, and in multiplayer see the other players.
// The current selection mechanic is a placeholder: Space adds the artwork under the car to the
// inventory. Whatever adds to the inventory, new items are sent to the other players.
import { stepCar, createCar, removeCar, placeCar, syncCarModel, setCarLabel, setCarColor } from '../game/car.js';
import { chase, groundPointAt, isDragging } from '../game/camera.js';
import { driveInput, setDrivingEnabled, onKey } from '../game/input.js';
import { tileAt, progress, spawnPoint, world } from '../game/world.js';
import { createMinimap } from '../game/minimap.js';
import { cssColor, selfPlayer, PLAYER_COLORS } from '../net/net.js';
import { canvas } from '../scene.js';
import { render, esc } from '../ui.js';

const SEND_HZ = 15;        // how often we send our car's position
const IDLE_SEND_S = 1;     // when not moving, still send this often so late messages settle
const SMOOTHING = 12;      // how fast remote cars catch up with their latest position (per second)
const SCOREBOARD_OTHERS = 4; // other players listed in the HUD (highest scores first); the rest are summarised

let $, ctx, net, off = [], lastTileId, minimap;
let remotes = new Map();   // player id → { player, car, target, picks: tileId[] }
let sendTimer = 0, idleTimer = 0, lastSent = '';
let sentIds = new Set();   // inventory ids already announced to the other players

const finishRun = () => ctx.go('finish', {
  items: ctx.inventory.items,
  mode: ctx.session.mode,
  others: [...remotes.values()].map(r => ({
    name: r.player.name,
    color: r.player.color,
    items: r.picks.map(id => world.byId.get(id)).filter(Boolean)
      .map(t => ({ id: t.id, acc: t.acc, title: t.title, url: t.url })),
  })),
});

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

function announceNewPicks(items) {
  for (const i of items) {
    if (sentIds.has(i.id)) continue;
    sentIds.add(i.id);
    net.sendSelected(i.id);
  }
}

// --- Screen ------------------------------------------------------------------------

export default {
  mount(root, context) {
    ctx = context;
    net = ctx.session.mode === 'multi' ? ctx.session.net : null;
    lastTileId = undefined;
    setCarColor(ctx.car, selfPlayer(net)?.color ?? PLAYER_COLORS[0]);
    $ = render(root, `
      <div class="panel hud">
        <div class="status"></div>
        <div class="location"></div>
        <div class="inv"></div>
        <div class="scores"></div>
        <div class="net-error"></div>
        <div class="muted">Arrow keys to drive · Space to select · scroll to zoom · drag to look around · Esc to finish</div>
        <button class="finish-btn">Finish run</button>
      </div>
      <div class="tip"></div>`);
    $('.finish-btn').onclick = finishRun;
    minimap = createMinimap();
    root.append(minimap.canvas);

    const showInventory = items => {
      $('.inv').textContent = `Selected: ${items.length}`;
      if (net) { announceNewPicks(items); showScores(); }
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
        if (e.key === 'Escape') finishRun();
        if (e.key === ' ') {
          e.preventDefault();
          const t = tileAt(ctx.car.x, ctx.car.y);
          if (t) ctx.inventory.add(t);
        }
      }),
    ];

    if (net) {
      sentIds = new Set();
      sendTimer = idleTimer = 0;
      lastSent = '';
      off.push(
        net.on('players', syncPlayers),
        net.on('state', s => { const r = remotes.get(s.id); if (r) r.target = s; }),
        net.on('selected', ({ id, tileId }) => {
          const r = remotes.get(id);
          if (r && !r.picks.includes(tileId)) { r.picks.push(tileId); showScores(); }
        }),
        net.on('error', msg => { $('.net-error').textContent = msg; }),
      );
      syncPlayers(net.players);
    }
    showInventory(ctx.inventory.items);
  },

  update(dt) {
    stepCar(ctx.car, driveInput(), dt);
    if (net) {
      sendOwnState(dt);
      updateRemotes(dt);
    }
    const t = tileAt(ctx.car.x, ctx.car.y);
    if (t?.id !== lastTileId) {
      lastTileId = t?.id;
      $('.location').textContent = t ? `On: ${t.title} (${t.acc})` : 'Off-road — in a gap';
    }
    $('.status').textContent = progress.done ? '' : `Loading artworks… ${progress.loaded}/${progress.total}`;
    minimap.draw([
      { ...ctx.car, color: selfPlayer(net)?.color ?? PLAYER_COLORS[0], self: true },
      ...[...remotes.values()].map(r => ({ x: r.car.x, y: r.car.y, heading: r.car.heading, color: r.player.color })),
    ]);
  },

  unmount() {
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
