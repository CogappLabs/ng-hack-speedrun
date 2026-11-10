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
};

// heading 0 = east, -π/2 = north
export function createCar({ color = 0xe63946 } = {}) {
  const car = { x: 0, y: 0, heading: -Math.PI / 2, speed: 0, steer: 0, model: buildModel(color) };
  scene.add(car.model.group);
  return car;
}

export function removeCar(car) {
  scene.remove(car.model.group);
}

export function placeCar(car, x, y, heading = -Math.PI / 2) {
  Object.assign(car, { x, y, heading, speed: 0, steer: 0 });
}

// input: { up, down, steer } where steer is -1 (left), 0 or 1 (right).
export function stepCar(car, { up, down, steer }, dt) {
  car.steer = steer;
  if (up) car.speed += CAR.accel * dt;
  if (down) car.speed -= (car.speed > 0 ? CAR.brake : CAR.accel) * dt;
  if (!up && !down) {
    car.speed -= car.speed * CAR.drag * dt;
    if (Math.abs(car.speed) < 5) car.speed = 0;
  }
  car.speed = Math.max(-CAR.reverseMax, Math.min(CAR.maxSpeed, car.speed));

  // Steering authority ramps up with speed; reversing flips the turn direction like a real car.
  const authority = Math.min(1, Math.abs(car.speed) / 300) * Math.sign(car.speed);
  car.heading += steer * CAR.turnRate * authority * dt;

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
  const spin = (car.speed * dt) / 13;
  for (let i = 0; i < 4; i++) {
    wheels[i].rotation.z -= spin;
    if (i < 2) wheels[i].rotation.y = -car.steer * 0.35;  // front wheels turn
  }
}

// --- Model -------------------------------------------------------------------------
// Built facing +X so that rotation.y = -heading lines it up with the 2D heading.
const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a35, roughness: 0.1, metalness: 0.6 });
const headMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
const tyre = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
const wheelGeo = new THREE.CylinderGeometry(13, 13, 10, 18).rotateX(Math.PI / 2);
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

function buildModel(color) {
  const { length: L, width: W } = CAR;
  const group = new THREE.Group();
  const body = new THREE.Group();  // tilts with steering; the wheels and shadow stay put
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 });

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(L, 22, W), paint);
  chassis.position.y = 22;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(L * 0.5, 20, W * 0.86), glass);
  cabin.position.set(-L * 0.06, 43, 0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L * 0.42, 4, W * 0.8), paint);
  roof.position.set(-L * 0.08, 54, 0);
  body.add(chassis, cabin, roof);
  for (const z of [-W * 0.32, W * 0.32]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(2, 7, 11), headMat);
    head.position.set(L / 2 + 1, 25, z);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(2, 6, 11), tailMat);
    rear.position.set(-L / 2 - 1, 25, z);
    body.add(head, rear);
  }
  group.add(body);

  const wheels = [];
  for (const [x, z] of [[L * 0.3, -W / 2], [L * 0.3, W / 2], [-L * 0.3, -W / 2], [-L * 0.3, W / 2]]) {
    const w = new THREE.Mesh(wheelGeo, tyre);
    w.position.set(x, 13, z);
    wheels.push(w);
    group.add(w);
  }

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.4, W * 1.6).rotateX(-Math.PI / 2), shadowMat);
  shadow.position.y = 1;
  group.add(shadow);
  return { group, body, wheels };
}
