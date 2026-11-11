// Boot and main loop. Owns the screen router; screens do everything else.
//
// A screen is a module whose default export is:
//   { mount(root, ctx, data), unmount?(), update?(dt) }
// mount() draws into root (the #screen overlay); update(dt) runs every frame while it's active.
// Screens move on with ctx.go(name, data). The 3D world renders behind every screen.
import { renderer, scene, camera } from './scene.js';
import { useMap, loadImages, updateTextures, spawnPoint, randomSeed, restoreTiles, challengeFor } from './game/world.js';
import { createCar, placeCar, syncCarModel } from './game/car.js';
import { chase, updateCamera } from './game/camera.js';
import { inventory } from './inventory.js';
import { loadOptions, cleanOptions, DEFAULT_OPTIONS } from './options.js';
import landing from './screens/landing.js';
import lobby from './screens/lobby.js';
import play from './screens/play.js';
import finish from './screens/finish.js';

const screens = { landing, lobby, play, finish };
const root = document.getElementById('screen');
let current = null;

// Shared state passed to every screen.
const ctx = {
  car: null,                                  // the local player's car (also the camera's target)
  challenge: null,                            // this run's { label, name, tiles }: photograph 10 of these
  options: loadOptions(),                     // the player's chosen { mode, minutes } (options.js), set on the landing screen
  runOptions: null,                           // this run's { mode, minutes }: ctx.options, or the room's in multiplayer
  session: { mode: 'single', net: null },     // mode: 'single' | 'multi'; net: a Net (net/net.js) in multiplayer
  inventory,

  go(name, data = {}) {
    current?.unmount?.();
    root.replaceChildren();
    current = screens[name];
    current.mount(root, ctx, data);
  },

  // Put back any photographed artworks, pick the challenge, put the car on a random starting
  // tile and empty the inventory, ready for a new run.
  // In multiplayer, pass the player's slot (Player.slot) and the seed from the 'start' event
  // so every player gets a different tile and everyone agrees on where everyone starts,
  // plus the room's options from the same event. The map must already be the options' map
  // (await useMap(options.map, options.difficulty) from game/world.js first).
  newRun(slot = 0, seed = randomSeed(), options = ctx.options) {
    restoreTiles();
    ctx.runOptions = cleanOptions(options);
    ctx.challenge = challengeFor(seed);
    const s = spawnPoint(seed, slot);
    placeCar(ctx.car, s.x, s.y, s.heading);
    chase.yaw = ctx.car.heading;
    inventory.reset();
  },
};

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000);  // clamp so a background tab doesn't teleport the car
  lastT = now;
  current?.update?.(dt);
  syncCarModel(ctx.car, dt);
  updateCamera(ctx.car, dt);
  updateTextures(ctx.car.x, ctx.car.y);
  renderer.render(scene, camera);
}

await useMap(ctx.options.map, ctx.options.difficulty)
  .catch(() => useMap(DEFAULT_OPTIONS.map, DEFAULT_OPTIONS.difficulty));
ctx.car = createCar();
ctx.newRun();
updateCamera(ctx.car, 0, true);
ctx.go('landing');
requestAnimationFrame(frame);
loadImages(ctx.car);
