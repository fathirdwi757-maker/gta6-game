// A small seeded random number generator (mulberry32) plus helpers.
// The city and the screenshot scenes are built from a fixed seed so every
// player — and every screenshot — sees the same Solano City.

export function makeRng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

// The one RNG the world generation uses; gameplay randomness uses Math.random
// through the helpers below so a saved city layout never shifts mid-session.
export const worldRng = makeRng(20261119);

export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Shortest signed angular difference from a to b, in radians.
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const dist2d = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);
