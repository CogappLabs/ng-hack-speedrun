// The "Images and data … Credits." line along the bottom of the screen, and the full-screen
// credits overlay its button opens. The markup (and the credits text) is in index.html.

const overlay = document.getElementById('credits');
const openBtn = document.querySelector('.credits-open');
const closeBtn = overlay.querySelector('.credits-close');

function show(on) {
  overlay.hidden = !on;
  (on ? closeBtn : openBtn).focus();
}

openBtn.onclick = () => show(true);
closeBtn.onclick = () => show(false);
overlay.onclick = e => { if (e.target === overlay) show(false); };  // click outside the panel

// Escape closes it, before any screen's own key handling sees the key.
addEventListener('keydown', e => {
  if (overlay.hidden || e.key !== 'Escape') return;
  e.stopPropagation();
  show(false);
}, true);
