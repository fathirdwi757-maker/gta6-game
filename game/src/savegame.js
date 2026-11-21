// Save / continue through localStorage. One JSON record: cash, finished
// missions, the player's position and the car they last left parked.

import { CASH, SPAWN } from './config.js';

const KEY = 'solano-heat-save-v1';

export function defaultSave() {
  return {
    cash: CASH.start,
    missionsDone: [],
    x: SPAWN.x,
    z: SPAWN.z,
    heading: SPAWN.heading,
    car: null, // { x, z, heading, model, color } of the last car the player left
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || typeof data.cash !== 'number') return null;
    return { ...defaultSave(), ...data, missionsDone: Array.isArray(data.missionsDone) ? data.missionsDone : [] };
  } catch {
    return null;
  }
}

export function storeSave(save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Private mode or a full quota: the game simply runs unsaved.
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
