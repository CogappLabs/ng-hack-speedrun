// Keyboard input. Arrow keys drive only while driving is enabled (the play screen turns it on).
const keys = new Set();
const listeners = new Set();
const upListeners = new Set();
let driving = false;

export function setDrivingEnabled(on) {
  driving = on;
  if (!on) keys.clear();
}

// Current driving controls, in the shape stepCar() expects.
export function driveInput() {
  return {
    up: keys.has('ArrowUp'),
    down: keys.has('ArrowDown'),
    steer: (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0),
  };
}

// Listen for any keydown (not just arrows). Returns an unsubscribe function.
export function onKey(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

addEventListener('keydown', e => {
  // Leave typing in text fields alone (e.g. the lobby's name and room code).
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (driving && e.key.startsWith('Arrow')) { keys.add(e.key); e.preventDefault(); }
  for (const fn of listeners) fn(e);
});
// Listen for keyup. Also called with { key: null } when the window loses focus, since the
// matching keyup never arrives then. Returns an unsubscribe function.
export function onKeyUp(fn) {
  upListeners.add(fn);
  return () => upListeners.delete(fn);
}

addEventListener('keyup', e => {
  keys.delete(e.key);
  for (const fn of upListeners) fn(e);
});
addEventListener('blur', () => {
  keys.clear();
  for (const fn of upListeners) fn({ key: null });
});
