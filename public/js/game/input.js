// Driving input from the keyboard and a game controller. Driving controls only work while
// driving is enabled (the play screen turns it on).
//
// Keyboard: arrow keys or WASD to drive (matched by key position, so ZQSD on AZERTY works too),
// B to boost. Other keys go to onKey/onKeyUp listeners.
//
// Controller (Gamepad API, "standard" mapping, e.g. an Xbox controller): RT/LT accelerate and
// brake (analogue), left stick or D-pad to steer, B to boost, right stick to look around.
// A, Y, Menu and View are passed to onKey/onKeyUp listeners as Space, Z, Escape and M, so screens
// handle them like the keyboard. Browsers only reveal a controller once a button is pressed.
const keys = new Set();       // KeyboardEvent.code values held down
const listeners = new Set();
const upListeners = new Set();
let driving = false;

const UP = ['ArrowUp', 'KeyW'], DOWN = ['ArrowDown', 'KeyS'];
const LEFT = ['ArrowLeft', 'KeyA'], RIGHT = ['ArrowRight', 'KeyD'];
const DRIVE_CODES = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT]);
const BOOST = 'KeyB';

// Standard gamepad mapping: button indices and axes.
const PAD = { A: 0, B: 1, Y: 3, LT: 6, RT: 7, VIEW: 8, MENU: 9, DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15 };
const PAD_KEYS = { [PAD.A]: ' ', [PAD.Y]: 'z', [PAD.MENU]: 'Escape', [PAD.VIEW]: 'm' };  // buttons passed on as keys
const DEADZONE = 0.15;        // stick movement smaller than this is ignored
const TRIGGER_MIN = 0.05;     // trigger pressure smaller than this is ignored

export function setDrivingEnabled(on) {
  driving = on;
  if (!on) keys.clear();
}

const held = codes => codes.some(c => keys.has(c));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Rescale a stick axis so it starts from 0 at the edge of the deadzone.
const stick = v => Math.abs(v) < DEADZONE ? 0 : Math.sign(v) * (Math.abs(v) - DEADZONE) / (1 - DEADZONE);

// The first connected controller with the standard mapping, or null.
function pad() {
  for (const p of navigator.getGamepads?.() ?? []) if (p?.connected && p.mapping === 'standard') return p;
  return null;
}
const pressed = (p, i) => !!p?.buttons[i]?.pressed;
const value = (p, i) => p?.buttons[i]?.value ?? 0;

export const padConnected = () => !!pad();

// Current driving controls, in the shape stepCar() expects. up and down are 0-1 (analogue on a
// controller's triggers), steer is -1 (left) to 1 (right), boost is true while held.
export function driveInput() {
  const p = driving ? pad() : null;
  const trigger = i => (value(p, i) > TRIGGER_MIN ? value(p, i) : 0);
  return {
    up: Math.max(held(UP) ? 1 : 0, trigger(PAD.RT), pressed(p, PAD.DPAD_UP) ? 1 : 0),
    down: Math.max(held(DOWN) ? 1 : 0, trigger(PAD.LT), pressed(p, PAD.DPAD_DOWN) ? 1 : 0),
    steer: clamp((held(RIGHT) ? 1 : 0) - (held(LEFT) ? 1 : 0)
      + (pressed(p, PAD.DPAD_RIGHT) ? 1 : 0) - (pressed(p, PAD.DPAD_LEFT) ? 1 : 0)
      + stick(p?.axes[0] ?? 0), -1, 1),
    boost: keys.has(BOOST) || pressed(p, PAD.B),
  };
}

// The controller's right stick, -1 to 1 on each axis (0 with no controller), for looking around.
export function lookInput() {
  const p = driving ? pad() : null;
  return { x: stick(p?.axes[2] ?? 0), y: stick(p?.axes[3] ?? 0) };
}

// Does this keydown start driving? (Arrow keys, WASD, or the controller's drive controls.)
// The play screen uses it to swing the camera back behind the car.
export const isDriveKey = e => DRIVE_CODES.has(e.code) || !!e.padDrive;

// Listen for any keydown (not just driving keys). Controller buttons A, Y, Menu and View arrive
// as { key: ' ' | 'z' | 'Escape' | 'm', gamepad: true }. Returns an unsubscribe function.
export function onKey(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

addEventListener('keydown', e => {
  // Leave typing in text fields alone (e.g. the lobby's name and room code).
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  if (driving && plain && (DRIVE_CODES.has(e.code) || e.code === BOOST)) {
    keys.add(e.code);
    e.preventDefault();
  }
  for (const fn of listeners) fn(e);
});
// Listen for keyup. Also called with { key: null } when the window loses focus, since the
// matching keyup never arrives then. Returns an unsubscribe function.
export function onKeyUp(fn) {
  upListeners.add(fn);
  return () => upListeners.delete(fn);
}

addEventListener('keyup', e => {
  keys.delete(e.code);
  for (const fn of upListeners) fn(e);
});
addEventListener('blur', () => {
  keys.clear();
  for (const fn of upListeners) fn({ key: null });
});

// --- Controller buttons --------------------------------------------------------------
// The Gamepad API has no events for buttons, so poll every frame and turn presses into
// onKey/onKeyUp calls.
const padEvent = (key, extra = {}) => ({ key, code: '', repeat: false, gamepad: true, preventDefault() {}, ...extra });
let wasDown = new Set(), wasDriving = false;

function pollPad() {
  requestAnimationFrame(pollPad);
  const p = pad();
  const down = new Set();
  if (p) for (const i of Object.keys(PAD_KEYS)) if (pressed(p, +i)) down.add(+i);
  for (const i of down) if (!wasDown.has(i)) for (const fn of listeners) fn(padEvent(PAD_KEYS[i]));
  for (const i of wasDown) if (!down.has(i)) for (const fn of upListeners) fn(padEvent(PAD_KEYS[i]));
  wasDown = down;

  // Starting to drive with the controller counts as a drive key press (see isDriveKey).
  const d = driving && p ? driveInput() : null;
  const isDriving = !!d && (d.up > 0 || d.down > 0 || d.steer !== 0);
  if (isDriving && !wasDriving) for (const fn of listeners) fn(padEvent('', { padDrive: true }));
  wasDriving = isDriving;
}
requestAnimationFrame(pollPad);
