// Small DOM helpers for screens.

// Escape text for use inside innerHTML. Artwork titles come from data, so always escape them.
export const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

// Put markup into root and return a querySelector bound to it.
export function render(root, markup) {
  root.innerHTML = markup;
  return sel => root.querySelector(sel);
}
