// Feature 4: results. Each player's score is how many of their photos show the challenge
// subject. Players are ranked by score, and every photo is shown, ticked if it matches.
//
// data: {
//   mode: 'single' | 'multi',
//   options: { mode: 'time' | 'challenge', minutes },   see ../options.js
//   challenge: { label, name, tiles } | null,   e.g. { label: 'hat', name: 'hats' }
//   endedBy: name of whoever filled their film first ('You' for us), or null,
//   reason: 'full' (endedBy filled their film) | 'time' (the clock ran out)
//           | 'all-full' (time mode: everyone's film is full) | 'quit' (we left early),
//   players: [{ name, color, self, score, photos: [{ id, acc, title, url, match }] }],
// }
import { render, esc } from '../ui.js';
import { chase, normaliseOrbit } from '../game/camera.js';
import { cssColor } from '../net/net.js';
import { COLLECTION_SIZE } from '../config.js';
import { cleanOptions, minutesText } from '../options.js';

let $;

function ordinal(n) {
  const suffix = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}

const photoGrid = photos => `
  <div class="works">
    ${photos.map(p => `
      <figure class="${p.match ? 'match' : 'miss'}">
        <div class="photo">
          <img src="${esc(p.url)}" alt="${esc(p.title)}" loading="lazy">
          ${p.match ? '<span class="tick" aria-label="Matches the challenge">✓</span>' : ''}
        </div>
        <figcaption>${esc(p.title)} <span class="muted">(${esc(p.acc)})</span></figcaption>
      </figure>`).join('')}
  </div>`;

export default {
  mount(root, ctx, { mode = 'single', options, challenge = null, endedBy = null, reason = endedBy ? 'full' : 'quit', players = [] }) {
    const name = challenge?.name ?? 'matching artworks';
    const opts = cleanOptions(options);
    const ranked = [...players].sort((a, b) => b.score - a.score || Number(b.self) - Number(a.self));
    const rankOf = p => 1 + players.filter(q => q.score > p.score).length;  // ties share a place
    const me = players.find(p => p.self);

    let headline;
    if (mode === 'single') {
      headline = `You found ${me?.score ?? 0} ${name} in ${me?.photos.length ?? 0} photo${me?.photos.length === 1 ? '' : 's'}`;
    } else {
      const top = ranked.filter(p => rankOf(p) === 1 && p.score > 0);
      headline = !top.length ? `Nobody found any ${name}`
        : top.length > 1 ? `It’s a tie: ${top.map(p => p.self ? 'you' : esc(p.name)).join(' and ')}`
        : top[0].self ? 'You win!' : `${esc(top[0].name)} wins!`;
    }
    const why = reason === 'time' ? 'Time’s up.'
      : reason === 'all-full' ? 'Everyone’s film is full.'
      : mode === 'single' ? (reason === 'full' ? 'Your film is full.'
        : opts.mode === 'time' ? 'You stopped before the time ran out.' : 'You stopped before your film was full.')
      : endedBy === 'You' ? 'You filled your film first.'
      : endedBy ? `${esc(endedBy)} filled their film first.`
      : opts.mode === 'time' ? 'You left before the time ran out.'
      : 'You left before anyone filled their film.';
    const task = opts.mode === 'time'
      ? `photograph as many ${esc(name)} as you can in ${minutesText(opts.minutes)}`
      : `photograph ${COLLECTION_SIZE} examples of ${esc(name)}`;

    $ = render(root, `
      <div class="panel centre finish">
        <p class="muted challenge">Challenge: ${task}</p>
        <h2>${headline}</h2>
        <p class="muted">${why}</p>
        ${ranked.map(p => `
          <section class="result${p.self ? ' self' : ''}">
            <h3>
              ${mode === 'multi' ? `<span class="rank">${ordinal(rankOf(p))}</span>` : ''}
              <span style="color:${cssColor(p.color)}">●</span> ${p.self ? 'You' : esc(p.name)}
              <span class="score">${p.score} ${esc(name)}</span>
            </h3>
            ${p.photos.length ? photoGrid(p.photos) : '<p class="muted">No photos.</p>'}
          </section>`).join('')}
        <div class="row"><button class="primary again">Play again</button></div>
      </div>`);
    $('.again').onclick = () => {
      ctx.session.net?.leave();
      ctx.session = { mode: 'single', net: null };
      ctx.newRun();  // put photographed artworks back on the map behind the landing screen
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
