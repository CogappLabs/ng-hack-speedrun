// Chase camera: sits behind and above a car and swings round after it with a little lag.
// Dragging orbits the camera around the car; scrolling changes the distance.
import * as THREE from 'three';
import { CELL } from '../config.js';
import { camera, canvas, scene } from '../scene.js';

export const chase = {
  dist: 420,            // distance behind the car (scroll to change)
  heightRatio: 0.42,    // height as a fraction of distance
  lookAhead: 160,       // aim this far in front of the car
  yaw: -Math.PI / 2,    // smoothed camera heading
  orbit: 0,             // extra yaw from dragging (or the landing screen's slow spin)
  orbitReturn: true,    // when true, orbit eases back to 0 so the camera returns behind the car
};

export function updateCamera(car, dt, snap = false) {
  const k = snap ? 1 : 1 - Math.exp(-dt * 4);
  let diff = car.heading - chase.yaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  chase.yaw += diff * k;
  if (chase.orbitReturn) chase.orbit *= Math.exp(-dt * 3);
  const yaw = chase.yaw + chase.orbit;
  const fx = Math.cos(yaw), fz = Math.sin(yaw);
  camera.position.set(car.x - fx * chase.dist, chase.dist * chase.heightRatio, car.y - fz * chase.dist);
  camera.lookAt(car.x + fx * chase.lookAhead, 20, car.y + fz * chase.lookAhead);
  // Pull the fog in when the camera is close so the horizon stays hidden.
  scene.fog.near = CELL * 8 + chase.dist;
  scene.fog.far = CELL * 18 + chase.dist * 2;
  camera.far = scene.fog.far + CELL;
  camera.updateProjectionMatrix();
}

// Wrap orbit into (-π, π] so easing back never spins the long way round.
export function normaliseOrbit() {
  chase.orbit = Math.atan2(Math.sin(chase.orbit), Math.cos(chase.orbit));
}

// The world (x, y) point on the ground under a screen position, or null (e.g. pointing at the sky).
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2(), hit = new THREE.Vector3();
export function groundPointAt(clientX, clientY) {
  ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(groundPlane, hit) ? { x: hit.x, y: hit.z } : null;
}

let drag = null;
export const isDragging = () => drag !== null;
canvas.addEventListener('pointerdown', e => {
  drag = { x: e.clientX };
  chase.orbitReturn = false;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => { drag = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  chase.orbit += (e.clientX - drag.x) * 0.006;
  drag.x = e.clientX;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  chase.dist = Math.min(2400, Math.max(160, chase.dist * Math.exp(e.deltaY * 0.0015)));
}, { passive: false });
