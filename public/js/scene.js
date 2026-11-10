// The single Three.js renderer, scene and camera, shared by every screen.
import * as THREE from 'three';
import { CELL, SKY } from './config.js';

export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
export const canvas = renderer.domElement;
canvas.id = 'scene';
document.body.prepend(canvas);

export const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, CELL * 10, CELL * 20);
export const camera = new THREE.PerspectiveCamera(60, 1, 5, CELL * 24);

scene.add(new THREE.HemisphereLight(0xdde6ff, 0x30302a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(-1, 2, -0.6);
scene.add(sun);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
