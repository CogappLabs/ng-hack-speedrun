// Feature 1: landing page. Choose single player or multiplayer.
// The world slowly spins behind the panel while the images load.
import { chase, normaliseOrbit } from '../game/camera.js';
import { progress } from '../game/world.js';
import { render } from '../ui.js';

let $;

export default {
  mount(root, ctx) {
    $ = render(root, `
      <div class="panel centre landing">
        <h1>Art Drive</h1>
        <p class="muted">Race across the National Gallery's collection and photograph the paintings that match your challenge.</p>
        <div class="row">
          <button class="primary" data-mode="single">Single player</button>
          <button data-mode="multi">Multiplayer</button>
        </div>
        <p class="muted status"></p>
      </div>`);
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
