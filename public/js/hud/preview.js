// Artwork preview, top centre of the play screen: the artwork under the car, its title,
// and a hint about photographing it. Hidden when the car is in a gap. zoom(true) makes it
// fill most of the screen (the play screen does this while Z is held).

// A tile's attribution is HTML (the artist linked to their page, then their dates); show just its text.
const plainText = html => html ? new DOMParser().parseFromString(html, 'text/html').body.textContent.trim() : '';

export function createPreview() {
  const el = document.createElement('div');
  el.className = 'panel preview';
  el.hidden = true;
  el.innerHTML = `
    <img alt="">
    <div class="preview-title"></div>
    <div class="preview-attribution"></div>
    <div class="preview-hint muted"></div>`;
  const img = el.querySelector('img');
  const title = el.querySelector('.preview-title');
  const attribution = el.querySelector('.preview-attribution');
  const hint = el.querySelector('.preview-hint');
  let currentId = null, currentHint = null;
  img.onload = () => el.style.setProperty('--ar', img.naturalWidth / img.naturalHeight);

  return {
    el,
    img,  // the film strip animates photographed artworks out of this image

    zoom(on) {
      el.classList.toggle('zoomed', on);
    },

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
        attribution.textContent = plainText(tile.attribution);
        el.hidden = false;
      }
      if (hintText !== currentHint) {
        currentHint = hintText;
        hint.textContent = hintText;
      }
    },
  };
}
