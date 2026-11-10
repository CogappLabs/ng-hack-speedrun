// Feature 3: gameplay. Drive, select artworks, and (in multiplayer) see the other players.
// The current selection mechanic is a placeholder: Space adds the artwork under the car to the
// inventory. Remote players' cars aren't drawn yet: see ctx.session.net and the Net events.
import { stepCar } from '../game/car.js';
import { chase, groundPointAt, isDragging } from '../game/camera.js';
import { driveInput, setDrivingEnabled, onKey } from '../game/input.js';
import { tileAt, progress } from '../game/world.js';
import { canvas } from '../scene.js';
import { render } from '../ui.js';

let $, ctx, off = [], lastTileId;

const finishRun = () => ctx.go('finish', { items: ctx.inventory.items, mode: ctx.session.mode });

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

export default {
  mount(root, context) {
    ctx = context;
    lastTileId = undefined;
    $ = render(root, `
      <div class="panel hud">
        <div class="status"></div>
        <div class="location"></div>
        <div class="inv"></div>
        <div class="muted">Arrow keys to drive · Space to select · scroll to zoom · drag to look around · Esc to finish</div>
        <button class="finish-btn">Finish run</button>
      </div>
      <div class="tip"></div>`);
    $('.finish-btn').onclick = finishRun;

    const showInventory = items => { $('.inv').textContent = `Selected: ${items.length}`; };
    showInventory(ctx.inventory.items);

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
  },

  update(dt) {
    stepCar(ctx.car, driveInput(), dt);
    const t = tileAt(ctx.car.x, ctx.car.y);
    if (t?.id !== lastTileId) {
      lastTileId = t?.id;
      $('.location').textContent = t ? `On: ${t.title} (${t.acc})` : 'Off-road — in a gap';
    }
    $('.status').textContent = progress.done ? '' : `Loading artworks… ${progress.loaded}/${progress.total}`;
  },

  unmount() {
    setDrivingEnabled(false);
    off.forEach(f => f());
    off = [];
    ctx.car.speed = 0;
    ctx.car.steer = 0;
  },
};
