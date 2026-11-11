// Feature 1: landing page. Choose the game options (../options.js), then single player or
// multiplayer. The options are stored in ctx.options; in multiplayer they apply to rooms you
// create. The world slowly spins behind the panel while the images load.
import { chase, normaliseOrbit } from '../game/camera.js';
import { progress } from '../game/world.js';
import { MINUTES, saveOptions, optionsRules } from '../options.js';
import { render } from '../ui.js';

let $;

export default {
  mount(root, ctx) {
    $ = render(root, `
      <div class="panel centre landing">
        <h1>Art Drive</h1>
        <p class="muted">Race across the National Gallery's collection and photograph the paintings that match your challenge.</p>
        <div class="options">
          <div class="option">
            <span class="option-label">Mode</span>
            <div class="seg" role="group" aria-label="Mode">
              <button data-opt-mode="time">Time</button>
              <button data-opt-mode="challenge">Challenge</button>
            </div>
          </div>
          <div class="option time-only">
            <span class="option-label">Time</span>
            <div class="seg" role="group" aria-label="Time limit">
              ${MINUTES.map(m => `<button data-opt-minutes="${m}">${m} min</button>`).join('')}
            </div>
          </div>
          <p class="muted rules"></p>
        </div>
        <div class="row">
          <button class="primary" data-mode="single">Single player</button>
          <button data-mode="multi">Multiplayer</button>
        </div>
        <p class="muted status"></p>
      </div>`);

    const show = () => {
      const o = ctx.options;
      root.querySelectorAll('[data-opt-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.optMode === o.mode));
      root.querySelectorAll('[data-opt-minutes]').forEach(b => b.setAttribute('aria-pressed', +b.dataset.optMinutes === o.minutes));
      $('.time-only').hidden = o.mode !== 'time';
      $('.rules').textContent = optionsRules(o);
    };
    const set = change => { ctx.options = { ...ctx.options, ...change }; saveOptions(ctx.options); show(); };
    root.querySelectorAll('[data-opt-mode]').forEach(b => { b.onclick = () => set({ mode: b.dataset.optMode }); });
    root.querySelectorAll('[data-opt-minutes]').forEach(b => { b.onclick = () => set({ minutes: +b.dataset.optMinutes }); });
    show();

    $('[data-mode="single"]').onclick = () => {
      ctx.session = { mode: 'single', net: null };
      ctx.newRun();
      ctx.go('play');
    };
    $('[data-mode="multi"]').onclick = () => ctx.go('lobby');
    chase.orbitReturn = false;
  },

  update(dt) {
    chase.orbit += dt * 0.12;
    $('.status').textContent = progress.done
      ? `${progress.total} artworks`
      : `Loading artworks… ${progress.loaded}/${progress.total}`;
  },

  unmount() {
    normaliseOrbit();
    chase.orbitReturn = true;
  },
};
