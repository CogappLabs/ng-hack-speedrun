// Film strip along the bottom of the play screen: one frame per artwork the player can collect.
// Collected artworks fly into the next empty frame from wherever they were shown (the preview).

const FLY_MS = 700;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createFilmstrip(size) {
  const el = document.createElement('div');
  el.className = 'filmstrip';
  el.innerHTML = '<div class="frame"></div>'.repeat(size);
  const frames = [...el.children];

  function fill(frame, item) {
    frame.replaceChildren();
    frame.title = item ? `${item.title} (${item.acc})` : '';
    frame.classList.toggle('filled', !!item);
    if (!item) return;
    const img = new Image();
    img.src = item.url;
    img.alt = item.title;
    frame.append(img);
  }

  return {
    el,

    // Show inventory items in order, without animation (e.g. when the screen opens).
    set(items) {
      frames.forEach((f, i) => fill(f, items[i]));
    },

    // Fly `item` from the on-screen image `fromImg` into frame `index`, then show it there.
    add(item, index, fromImg) {
      const frame = frames[index];
      if (!frame) return;
      const from = fromImg?.isConnected && !fromImg.closest('[hidden]') && fromImg.getBoundingClientRect();
      if (!from || !from.width || reducedMotion()) {
        fill(frame, item);
        return;
      }
      const to = frame.getBoundingClientRect();
      // Shrink to fit inside the frame (keeping the artwork's shape), centred on it.
      const s = Math.min(to.width / from.width, to.height / from.height);
      const dx = to.left + (to.width - from.width * s) / 2 - from.left;
      const dy = to.top + (to.height - from.height * s) / 2 - from.top;

      const fly = new Image();
      fly.src = fromImg.src;
      fly.className = 'fly';
      Object.assign(fly.style, {
        left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
      });
      document.body.append(fly);
      const anim = fly.animate(
        [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }],
        { duration: FLY_MS, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' },
      );
      anim.finished.catch(() => {}).finally(() => {
        fly.remove();
        fill(frame, item);
        frame.classList.remove('pop');
        void frame.offsetWidth;  // restart the pop animation
        frame.classList.add('pop');
      });
    },
  };
}
