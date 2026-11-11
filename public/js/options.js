// Game options, chosen on the landing screen. In multiplayer the room creator's options apply
// to everyone in the room: they're sent with the create request and come back in the 'start' event.
//
// @typedef {{ mode: 'time' | 'challenge', minutes: number }} GameOptions
//   time:      photograph as many matching artworks as you can before the clock runs out
//   challenge: the first player to fill their film (COLLECTION_SIZE photos) ends the game
//
// Keep MODES and MINUTES in step with party/server.ts.
import { COLLECTION_SIZE } from './config.js';

export const MODES = ['time', 'challenge'];
export const MINUTES = [1, 2, 3, 5, 10];
export const DEFAULT_OPTIONS = { mode: 'time', minutes: 2 };

const KEY = 'artdrive.options';

// Fill in anything missing or invalid with the defaults.
export function cleanOptions(o) {
  return {
    mode: MODES.includes(o?.mode) ? o.mode : DEFAULT_OPTIONS.mode,
    minutes: MINUTES.includes(o?.minutes) ? o.minutes : DEFAULT_OPTIONS.minutes,
  };
}

export function loadOptions() {
  try { return cleanOptions(JSON.parse(localStorage.getItem(KEY))); } catch { return { ...DEFAULT_OPTIONS }; }
}

export function saveOptions(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
}

export const minutesText = m => `${m} minute${m === 1 ? '' : 's'}`;

// Short label, e.g. "Time mode · 2 minutes" or "Challenge mode".
export const optionsLabel = o => o.mode === 'time' ? `Time mode · ${minutesText(o.minutes)}` : 'Challenge mode';

// One-line explanation of the rules.
export const optionsRules = o => o.mode === 'time'
  ? `Photograph as many matching artworks as you can in ${minutesText(o.minutes)}. Your film holds ${COLLECTION_SIZE}.`
  : `The first to take ${COLLECTION_SIZE} photos ends the game. Choose carefully.`;
