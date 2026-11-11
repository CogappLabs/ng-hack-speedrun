// Game options, chosen on the landing screen. In multiplayer the room creator's options apply
// to everyone in the room: they're sent with the create request and come back in the 'start' event.
//
// @typedef {{ map: string, difficulty: string, mode: 'time' | 'challenge', minutes: number }} GameOptions
//   map:        how the artworks are arranged (MAPS), difficulty: how spread out (DIFFICULTIES).
//               Together they pick the layout file (layoutUrl in game/world.js).
//   time:      photograph as many matching artworks as you can before the clock runs out
//   challenge: the first player to fill their film (COLLECTION_SIZE photos) ends the game
//
// Keep MAPS, DIFFICULTIES, MODES and MINUTES in step with party/server.ts.
import { COLLECTION_SIZE } from './config.js';

export const MAPS = {
  visual: { name: 'Visual', about: 'Artworks that look alike are placed together.' },
  curatorial: { name: 'Curatorial', about: 'Artworks are arranged by their curatorial descriptions.' },
  clip: { name: 'CLIP', about: 'Artworks are arranged by the CLIP image model.' },
};
export const DIFFICULTIES = {
  easy: { name: 'Easy', about: 'A compact map with small gaps.' },
  medium: { name: 'Medium', about: 'A bigger map with wider gaps.' },
  hard: { name: 'Hard', about: 'The biggest map, with long drives between groups.' },
};
export const MODES = ['time', 'challenge'];
export const MINUTES = [1, 2, 3, 5, 10];
export const DEFAULT_OPTIONS = { map: 'visual', difficulty: 'medium', mode: 'time', minutes: 2 };
const own = (obj, k) => typeof k === 'string' && Object.hasOwn(obj, k);

const KEY = 'artdrive.options';

// Fill in anything missing or invalid with the defaults.
export function cleanOptions(o) {
  return {
    map: own(MAPS, o?.map) ? o.map : DEFAULT_OPTIONS.map,
    difficulty: own(DIFFICULTIES, o?.difficulty) ? o.difficulty : DEFAULT_OPTIONS.difficulty,
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

// Short label, e.g. "Visual map, medium · Time mode · 2 minutes" or "CLIP map, easy · Challenge mode".
export const mapLabel = o => `${MAPS[o.map].name} map, ${DIFFICULTIES[o.difficulty].name.toLowerCase()}`;
export const optionsLabel = o =>
  `${mapLabel(o)} · ${o.mode === 'time' ? `Time mode · ${minutesText(o.minutes)}` : 'Challenge mode'}`;

// One-line explanation of the rules.
export const optionsRules = o => o.mode === 'time'
  ? `Photograph as many matching artworks as you can in ${minutesText(o.minutes)}. Your film holds ${COLLECTION_SIZE}.`
  : `The first to take ${COLLECTION_SIZE} photos ends the game. Choose carefully.`;
