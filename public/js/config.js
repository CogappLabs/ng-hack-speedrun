// Shared constants. Game logic runs on a flat 2D plane (x east, y south) in world units;
// Three.js draws world (x, y) at 3D (x, 0, y), with Y pointing up.
export const CELL = 256;            // world units per grid cell
export const PAD = 8;               // gap inside each cell so tiles never touch
export const INNER = CELL - PAD * 2;
export const SKY = 0x1b1f27;
