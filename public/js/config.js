// Shared constants. Game logic runs on a flat 2D plane (x east, y south) in world units;
// Three.js draws world (x, y) at 3D (x, 0, y), with Y pointing up.
export const CELL = 256;            // world units per grid cell
export const PAD = 8;               // gap inside each cell so tiles never touch
export const INNER = CELL - PAD * 2;
export const SKY = 0x1b1f27;
export const COLLECTION_SIZE = 10;   // artworks each player can collect (frames in the film strip)

// Multiplayer server (PartyServer on Cloudflare Workers, see party/server.ts). `npm run party:dev`
// serves it on localhost:8787. After `npm run party:deploy`, put the workers.dev host it prints
// here. Add ?party=<host> to the page URL to override.
const DEPLOYED_PARTY_HOST = 'ng-hack-speedrun.cogapp.workers.dev';
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const PARTY_HOST = new URLSearchParams(location.search).get('party')
  || (isLocal ? 'localhost:8787' : DEPLOYED_PARTY_HOST);
