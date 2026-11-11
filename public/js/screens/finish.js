// Feature 4: final screen. Shows the works the player collected during the run and,
// in multiplayer, what the other players had collected when this player finished.
// data: { items, mode: 'single' | 'multi', others?: [{ name, color, items }] }
//   items are inventory items (see ../inventory.js): { id, acc, title, url }
import { render, esc } from '../ui.js';
import { chase, normaliseOrbit } from '../game/camera.js';
import { cssColor } from '../net/net.js';

let $;

const plural = n => `${n} work${n === 1 ? '' : 's'}`;

const grid = items => `
  <div class="works">
    ${items.map(i => `
      <figure>
        <img src="${esc(i.url)}" alt="${esc(i.title)}" loading="lazy">
        <figcaption>${esc(i.title)} <span class="muted">(${esc(i.acc)})</span></figcaption>
      </figure>`).join('')}
  </div>`;

export default {
  mount(root, ctx, { items = [], others = [] }) {
    $ = render(root, `
      <div class="panel centre finish">
        <h2>Your collection</h2>
        <p class="muted">${items.length ? `You collected ${plural(items.length)}.` : 'You didn’t collect any works this time.'}</p>
        ${grid(items)}
        ${others.map(o => `
          <h3><span style="color:${cssColor(o.color)}">●</span> ${esc(o.name)}</h3>
          <p class="muted">${o.items.length ? `${plural(o.items.length)} so far.` : 'No works collected yet.'}</p>
          ${grid(o.items)}`).join('')}
        <div class="row"><button class="primary again">Play again</button></div>
      </div>`);
    $('.again').onclick = () => {
      ctx.session.net?.leave();
      ctx.session = { mode: 'single', net: null };
      ctx.newRun();  // put collected artworks back on the map behind the landing screen
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
