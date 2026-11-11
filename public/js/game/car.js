// Cars: arcade physics on the 2D plane, plus a simple 3D model.
// createCar() can be called once per player, so remote players in multiplayer get their own car.
import * as THREE from 'three';
import { CELL } from '../config.js';
import { scene } from '../scene.js';
import { world } from './world.js';

// Simple arcade model: heading + scalar speed, steering scaled by speed so the
// car can't spin on the spot. Units are world units (CELL = one grid cell).
export const CAR = {
  length: 96, width: 52,
  accel: 900,          // u/s² when holding Up
  brake: 1800,         // u/s² when holding Down while moving forward
  reverseMax: 350,     // u/s
  maxSpeed: 1100,      // u/s (~4 cells/s)
  drag: 1.2,           // proportional slowdown per second when coasting
  turnRate: 2.6,       // rad/s at full steering authority
  // Boost (hold B): a burst of speed for crossing the map, from a tank that refills when not boosting.
  boostMaxSpeed: 2800, // u/s (~11 cells/s)
  boostAccel: 2600,    // u/s² while boosting
  boostSeconds: 3,     // a full tank lasts this long
  refillSeconds: 6,    // an empty tank refills in this long
  boostSettle: 2.5,    // after boosting, excess speed above maxSpeed fades at this rate per second
};

// heading 0 = east, -π/2 = north
export function createCar({ color = 0xe63946 } = {}) {
  // boost: how full the boost tank is (0-1); boosting: whether it's in use this frame.
  const car = { x: 0, y: 0, heading: -Math.PI / 2, speed: 0, steer: 0, boost: 1, boosting: false, model: buildModel(color) };
  scene.add(car.model.group);
  return car;
}

export function removeCar(car) {
  scene.remove(car.model.group);
}

export function setCarColor(car, color) {
  car.model.paint.color.setHex(color);
}

export function placeCar(car, x, y, heading = -Math.PI / 2) {
  Object.assign(car, { x, y, heading, speed: 0, steer: 0, boost: 1, boosting: false });
}

// input: { up, down, steer, boost }: up and down are 0-1 (true/false work too; a controller's
// triggers give values in between), steer is -1 (left) to 1 (right) and boost is true while
// held. Boosting drives forward even without Up.
export function stepCar(car, { up, down, steer, boost = false }, dt) {
  up = +up;
  down = +down;
  car.steer = Math.round(steer * 100) / 100;  // rounded: it's sent to other players
  car.boosting = boost && !down && car.boost > 0;
  if (car.boosting) {
    car.speed += CAR.boostAccel * dt;
    car.boost = Math.max(0, car.boost - dt / CAR.boostSeconds);
  } else {
    car.boost = Math.min(1, car.boost + dt / CAR.refillSeconds);
    car.speed += CAR.accel * up * dt;
  }
  if (down) car.speed -= (car.speed > 0 ? CAR.brake : CAR.accel) * down * dt;
  if (!up && !down && !car.boosting) {
    car.speed -= car.speed * CAR.drag * dt;
    if (Math.abs(car.speed) < 5) car.speed = 0;
  }
  // Above normal top speed (after a boost) ease back down rather than stopping dead.
  if (!car.boosting && car.speed > CAR.maxSpeed) {
    car.speed = Math.max(CAR.maxSpeed, car.speed - (car.speed - CAR.maxSpeed) * CAR.boostSettle * dt - CAR.accel * dt);
  }
  const top = car.boosting ? CAR.boostMaxSpeed : Math.max(CAR.maxSpeed, car.speed);
  car.speed = Math.max(-CAR.reverseMax, Math.min(top, car.speed));

  // Steering authority ramps up with speed; reversing flips the turn direction like a real car.
  const authority = Math.min(1, Math.abs(car.speed) / 300) * Math.sign(car.speed);
  car.heading += car.steer * CAR.turnRate * authority * dt;

  car.x += Math.cos(car.heading) * car.speed * dt;
  car.y += Math.sin(car.heading) * car.speed * dt;

  // Keep the car within the grid's bounds.
  car.x = Math.max(0, Math.min(world.cols * CELL, car.x));
  car.y = Math.max(0, Math.min(world.rows * CELL, car.y));
}

// Copy the car's 2D state onto its 3D model. Call once per frame for every car.
export function syncCarModel(car, dt) {
  const { group, body, wheels } = car.model;
  group.position.set(car.x, 0, car.y);
  group.rotation.y = -car.heading;
  // Lean out of corners a little, proportional to how hard we're turning.
  const lean = -car.steer * Math.min(1, Math.abs(car.speed) / CAR.maxSpeed) * 0.06;
  body.rotation.x += (lean - body.rotation.x) * Math.min(1, dt * 8);
  const spin = (car.speed * dt) / WHEEL_R;
  for (let i = 0; i < 4; i++) {
    wheels[i].rotation.z -= spin;
    if (i < 2) wheels[i].rotation.y = -car.steer * 0.35;  // front wheels turn
  }
}

// --- Model -------------------------------------------------------------------------
// A safari wagon: boxy two-tone body (player colour below, cream roof), chunky tyres, roof rack
// with luggage, bull bar, snorkel and a spare wheel on the back. Built facing +X so that
// rotation.y = -heading lines it up with the 2D heading. Units: world units (car is 96 long).
const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a35, roughness: 0.1, metalness: 0.6 });
const cream = new THREE.MeshStandardMaterial({ color: 0xece2c6, roughness: 0.6 });
const trim = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5, metalness: 0.4 });
const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a7350, roughness: 0.9 });
const canMat = new THREE.MeshStandardMaterial({ color: 0x3f5b3a, roughness: 0.6 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xffe8a3 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
const WHEEL_R = 15;
const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 12, 20).rotateX(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(7, 7, 13, 12).rotateX(Math.PI / 2);
const spokeGeo = new THREE.BoxGeometry(2.5, 12, 13.5);  // shows the wheels turning
const shadowMat = (() => {
  // Soft blob shadow so the car reads as sitting on the paintings.
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
})();

// A box of size (sx, sy, sz) centred at (x, y, z).
function box(mat, sx, sy, sz, x, y, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  return m;
}

function buildWheel() {
  const w = new THREE.Group();
  w.add(new THREE.Mesh(wheelGeo, tyre), new THREE.Mesh(hubGeo, cream), new THREE.Mesh(spokeGeo, trim));
  return w;
}

function buildModel(color) {
  const { length: L, width: W } = CAR;
  const group = new THREE.Group();
  const body = new THREE.Group();  // tilts with steering; the wheels and shadow stay put
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
  const cabinX = -L * 0.08, cabinL = L * 0.8;          // the tall rear section
  const front = cabinX + cabinL / 2, back = cabinX - cabinL / 2;

  body.add(
    box(paint, L, 18, W, 0, 31),                          // lower body, high off the ground
    box(trim, L + 2, 4, W + 2, 0, 23),                    // sills / bumpers
    box(paint, cabinL, 22, W * 0.94, cabinX, 51),         // boxy cabin
    box(cream, cabinL + 4, 3, W * 0.98, cabinX, 63.5),    // cream roof (two-tone)
    // Windows all round
    box(glass, cabinL * 0.84, 12, 1, cabinX, 53, W * 0.47 + 0.6),
    box(glass, cabinL * 0.84, 12, 1, cabinX, 53, -W * 0.47 - 0.6),
    box(glass, 1, 13, W * 0.8, front + 0.6, 53),
    box(glass, 1, 10, W * 0.7, back - 0.6, 55),
  );

  // Roof rack: two rails on posts, cross bars, a crate and two jerry cans.
  for (const z of [-W * 0.42, W * 0.42]) {
    body.add(box(trim, cabinL * 0.9, 2, 2, cabinX, 69, z));
    for (const x of [front - 6, back + 6]) body.add(box(trim, 2, 5, 2, x, 66.5, z));
  }
  for (const x of [front - 8, cabinX, back + 8]) body.add(box(trim, 2, 2, W * 0.86, x, 69));
  body.add(
    box(crateMat, 22, 9, 22, cabinX - 10, 74.5),
    box(canMat, 7, 10, 10, cabinX + 14, 75, -7),
    box(canMat, 7, 10, 10, cabinX + 22, 75, -7),
  );

  // Bull bar, snorkel, lights
  for (const z of [-W * 0.3, W * 0.3]) body.add(box(trim, 3, 20, 3, L / 2 + 4, 30, z));
  body.add(
    box(trim, 3, 3, W * 0.72, L / 2 + 4, 39),
    box(trim, 3, 3, W * 0.72, L / 2 + 4, 26),
    box(trim, 3, 30, 3, front - 4, 52, W / 2 + 2),       // snorkel up the right-hand side
    box(trim, 8, 3, 3, front - 2, 66, W / 2 + 2),
  );
  const lampGeo = new THREE.CylinderGeometry(4, 4, 2, 14).rotateZ(Math.PI / 2);
  for (const z of [-W * 0.32, W * 0.32]) {
    const lamp = new THREE.Mesh(lampGeo, headMat);
    lamp.position.set(L / 2 + 0.8, 33, z);
    body.add(lamp, box(tailMat, 2, 7, 6, -L / 2 - 1, 33, z * 1.2));
  }

  // Spare wheel on the back door.
  const spare = buildWheel();
  spare.rotation.y = Math.PI / 2;
  spare.scale.setScalar(0.85);
  spare.position.set(-L / 2 - 7, 42, 0);
  body.add(spare);
  group.add(body);

  const wheels = [];
  for (const [x, z] of [[L * 0.32, -W / 2], [L * 0.32, W / 2], [-L * 0.3, -W / 2], [-L * 0.3, W / 2]]) {
    const w = buildWheel();
    w.position.set(x, WHEEL_R, z);
    wheels.push(w);
    group.add(w);
  }

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.5, W * 1.7).rotateX(-Math.PI / 2), shadowMat);
  shadow.position.y = 1;
  group.add(shadow);
  return { group, body, wheels, paint };
}

// A floating name tag above the car (used for other players in multiplayer).
export function setCarLabel(car, text) {
  if (car.label) {
    car.model.group.remove(car.label);
    car.label.material.map.dispose();
    car.label.material.dispose();
  }
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = '600 40px system-ui, sans-serif';
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width) + 32;
  c.height = 60;
  g.font = font;
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, 14); g.fill();
  g.fillStyle = '#fff';
  g.textBaseline = 'middle';
  g.fillText(text, 16, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  label.scale.set(c.width * 0.9, c.height * 0.9, 1);
  label.position.y = 105;
  label.renderOrder = 1;
  car.model.group.add(label);
  car.label = label;
}
