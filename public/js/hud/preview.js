// Artwork preview, top centre of the play screen: the artwork under the car, its title,
// and a hint about collecting it. Hidden when the car is in a gap.

export function createPreview() {
  const el = document.createElement('div');
  el.className = 'panel preview';
  el.hidden = true;
  el.innerHTML = `
    <img alt="">
    <div class="preview-title"></div>
    <div class="preview-hint muted"></div>`;
  const img = el.querySelector('img');
  const title = el.querySelector('.preview-title');
  const hint = el.querySelector('.preview-hint');
  let currentId = null, currentHint = null;

  return {
    el,
    img,  // the film strip animates collected artworks out of this image

    // tile: a world tile or undefined; hintText: shown under the title.
    show(tile, hintText) {
      if (!tile) {
        if (currentId !== null) { el.hidden = true; currentId = null; }
        return;
      }
      if (tile.id !== currentId) {
        currentId = tile.id;
        img.src = tile.url;  // already in the browser cache: world.js loaded it for the tile
        img.alt = tile.title;
        title.textContent = `${tile.title} (${tile.acc})`;
        el.hidden = false;
      }
      if (hintText !== currentHint) {
        currentHint = hintText;
        hint.textContent = hintText;
      }
    },
  };
}
