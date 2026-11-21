// The wanted system and the Solano PD. Crimes add heat; heat makes stars;
// stars decide how many Interceptors hunt the player and how fast they are.
// Lose sight of the player and the heat cools until the stars drop away.

import { WANTED, WORLD } from './config.js';
import { createCar, stepCar, flashLightbars } from './vehicles.js';
import { rand, pick, clamp, angleDelta, dist2d } from './random.js';

const units = []; // { car, active }
let heat = 0;
let bustProgress = 0;
let seeing = false;
let sceneRef = null;

export const police = {
  get stars() {
    return Math.min(WANTED.maxStars, Math.floor(heat / WANTED.heatPerStar));
  },
  get heat() {
    return heat;
  },
  get bustProgress() {
    return bustProgress;
  },
  get seeing() {
    return seeing;
  },
  reportCrime(points) {
    heat = clamp(heat + points, 0, WANTED.maxStars * WANTED.heatPerStar + 40);
  },
  clear() {
    heat = 0;
    bustProgress = 0;
    for (const u of units) {
      u.active = false;
      u.car.group.visible = false;
      u.car.speed = 0;
    }
  },
  cars() {
    return units.filter((u) => u.active).map((u) => u.car);
  },
};

export function initPolice(scene, count = 7) {
  sceneRef = scene;
  for (let i = 0; i < count; i++) {
    const car = createCar(scene, 'interceptor', 0x15181d, 0, -999, 0);
    car.driver = 'police';
    car.group.visible = false;
    units.push({ car, active: false });
  }
}

function spawnPoint(playerPos) {
  // A road point 55–85 m from the player, out of their immediate view.
  const avenue = pick(WORLD.avenues);
  const street = pick(WORLD.streets);
  const onAvenue = Math.random() < 0.5;
  const x = onAvenue ? avenue : clamp(playerPos.x + rand(-85, 85), -WORLD.half + 20, WORLD.half - 20);
  const z = onAvenue ? clamp(playerPos.z + rand(-85, 85), -WORLD.half + 20, WORLD.half - 20) : street;
  if (dist2d(x, z, playerPos.x, playerPos.z) < 45) return spawnPoint(playerPos);
  return { x, z };
}

export function updatePolice(dt, target, elapsed) {
  const stars = police.stars;
  const want = WANTED.copCounts[stars];
  let activeCount = units.filter((u) => u.active).length;

  for (const u of units) {
    if (!u.active && activeCount < want) {
      const p = spawnPoint(target);
      u.car.x = p.x;
      u.car.z = p.z;
      u.car.heading = rand(0, Math.PI * 2);
      u.car.speed = 0;
      u.car.health = 100;
      u.car.dead = false;
      u.active = true;
      u.car.group.visible = true;
      activeCount++;
    } else if (u.active && activeCount > want) {
      u.active = false;
      u.car.group.visible = false;
      activeCount--;
    }
  }

  seeing = false;
  let cornering = false;
  const topSpeed = WANTED.copSpeed[Math.max(1, stars)];

  for (const u of units) {
    if (!u.active) continue;
    const car = u.car;
    const d = dist2d(car.x, car.z, target.x, target.z);
    if (d < WANTED.sightRange) seeing = true;
    if (d > 320) {
      const p = spawnPoint(target);
      car.x = p.x;
      car.z = p.z;
    }
    // Aim ahead of the target so the pursuit cuts corners instead of
    // trailing forever; at very close range aim at the target itself.
    const lead = clamp(d * 0.045, 0, 1.4);
    const aimX = target.x + (target.vx ?? 0) * lead;
    const aimZ = target.z + (target.vz ?? 0) * lead;
    const desired = Math.atan2(aimX - car.x, aimZ - car.z);
    const steer = clamp(angleDelta(car.heading, desired) * 2.4, -1, 1);
    let throttle = 0;
    const speedRatio = car.speed / topSpeed;
    if (d > 7) throttle = speedRatio < 0.98 ? 1 : 0;
    else if (d > 3.4) throttle = speedRatio < 0.4 ? 0.5 : -0.1;
    else throttle = -0.4; // nose to nose: back off a touch, stay threatening
    stepCar(car, { throttle, steer, handbrake: Math.abs(angleDelta(car.heading, desired)) > 2.2 }, dt);
    car.speed = clamp(car.speed, -9, topSpeed);

    // Bust pressure: the player is cornered when slow and a unit is close.
    const playerSlow = Math.abs(target.speed ?? 0) < 2.1;
    if (playerSlow && d < (target.inCar ? 7.5 : 3.6)) cornering = true;
  }

  if (stars > 0 && cornering) {
    bustProgress = clamp(bustProgress + dt / WANTED.bustFillTime, 0, 1);
  } else {
    bustProgress = clamp(bustProgress - dt * 1.8, 0, 1);
  }

  if (!seeing && stars > 0) {
    heat = Math.max(0, heat - WANTED.decayPerSecond * dt);
  }

  flashLightbars(police.cars(), elapsed);
  return { bust: bustProgress >= 1 };
}
