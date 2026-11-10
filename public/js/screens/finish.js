// Feature 4: final screen. Shows the works the player selected during the run.
// data: { items: inventory items (see ../inventory.js), mode: 'single' | 'multi' }
import { render, esc } from '../ui.js';
import { chase, normaliseOrbit } from '../game/camera.js';

let $;

export default {
  mount(root, ctx, { items = [] }) {
    $ = render(root, `
      <div class="panel centre finish">
        <h2>Your collection</h2>
        <p class="muted">${items.length ? `You selected ${items.length} work${items.length === 1 ? '' : 's'}.` : 'You didn’t select any works this time.'}</p>
        <div class="works">
          ${items.map(i => `
            <figure>
              <img src="${esc(i.url)}" alt="${esc(i.title)}" loading="lazy">
              <figcaption>${esc(i.title)} <span class="muted">(${esc(i.acc)})</span></figcaption>
            </figure>`).join('')}
        </div>
        <div class="row"><button class="primary again">Play again</button></div>
      </div>`);
    $('.again').onclick = () => {
      ctx.session.net?.leave();
      ctx.session = { mode: 'single', net: null };
      ctx.go('landing');
    };
    chase.orbitReturn = false;
  },

  update(dt) {
    chase.orbit += dt * 0.12;
  },

  unmount() {
    normaliseOrbit();
    chase.orbitReturn = true;
  },
};
