// Solano Heat — shared tuning constants for the city, the cars and the rules.
// Everything gameplay-related that more than one module needs lives here so the
// balance can be changed in one place.

// World geometry: the street grid is a set of avenues (constant x, running
// north-south) and streets (constant z, running east-west). Blocks sit between
// them. The playable ground is WORLD.half * 2 metres square, centred on 0,0.
export const WORLD = {
  half: 340,
  avenues: [-300, -220, -140, -60, 20, 100, 180, 260],
  streets: [-300, -220, -140, -60, 20, 100, 180, 260],
  roadWidth: 14,
  laneOffset: 3.6,
  beachX: 302, // east of this line the asphalt gives way to sand, then water
};

// Where the player wakes up: on foot beside a parked car on the beach avenue.
export const SPAWN = { x: 252, z: 96, heading: -Math.PI / 2 };

// Player on foot.
export const PLAYER = {
  radius: 0.45,
  walkSpeed: 5.2,
  sprintSpeed: 8.6,
  turnRate: 11,
  maxHealth: 100,
  punchRange: 1.7,
  punchDamage: 34,
  punchCooldown: 0.38,
};

// Car handling (arcade model shared by traffic, police and the player).
export const CAR = {
  accel: 15,
  brake: 26,
  reverseAccel: 8,
  drag: 0.55,
  grip: 7.5,
  steerMax: 0.55,
  handbrakeGrip: 1.6,
  maxHealth: 100,
};

// Wanted system: stars 0..5, heat builds from crimes and cools when unseen.
export const WANTED = {
  maxStars: 5,
  heatPerStar: 100,
  decayPerSecond: 7, // heat lost while no police unit can see the player
  sightRange: 65,
  bustFillTime: 2.6, // seconds boxed in / cornered before a bust
  copCounts: [0, 1, 2, 3, 5, 7], // interceptors active per star level
  copSpeed: [0, 21, 23, 25, 27, 29], // m/s pursuit speed per star level
};

// Palette: a warm late-afternoon grade over a teal sea.
export const COLORS = {
  sky: 0xffd9a0,
  fog: 0xf7c489,
  sun: 0xffb36b,
  sea: 0x1e7f86,
  sand: 0xe8cf9f,
  asphalt: 0x3c4148,
  sidewalk: 0x9aa0a3,
  grass: 0x69a85f,
};

// Economy.
export const CASH = { start: 120, bustFine: 0.25, wastedFine: 150 };
