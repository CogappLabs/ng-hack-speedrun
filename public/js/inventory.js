// The artworks the local player has collected during the current run (at most COLLECTION_SIZE).
// The play screen adds to it; the finish screen reads it. Items are plain objects:
//   { id, acc, title, url, pickedAt }   (pickedAt = ms since the run started)

import { COLLECTION_SIZE } from './config.js';

const items = [];
const listeners = new Set();
let runStart = performance.now();

const notify = () => { for (const fn of listeners) fn(inventory.items); };

export const inventory = {
  get items() { return items.slice(); },
  get size() { return items.length; },
  get full() { return items.length >= COLLECTION_SIZE; },
  has: id => items.some(i => i.id === id),

  // Add a world tile. Returns false if it was already collected or the collection is full.
  add(tile) {
    if (inventory.full || inventory.has(tile.id)) return false;
    items.push({ id: tile.id, acc: tile.acc, title: tile.title, url: tile.url, pickedAt: performance.now() - runStart });
    notify();
    return true;
  },

  remove(id) {
    const i = items.findIndex(x => x.id === id);
    if (i < 0) return false;
    items.splice(i, 1);
    notify();
    return true;
  },

  // Empty the inventory and restart the run clock. Called when a new run starts.
  reset() {
    items.length = 0;
    runStart = performance.now();
    notify();
  },

  // Called with the full item list whenever it changes. Returns an unsubscribe function.
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
