// Traffic: civilian cars that drive the grid on lanes, turn at intersections
// and brake for whatever is in front of them. Cars that drift too far from
// the player are recycled to roads nearer by, so the city always feels busy.

import { WORLD } from './config.js';
import { createCar, stepCar } from './vehicles.js';
import { rand, pick, clamp, angleDelta, dist2d } from './random.js';

const TRAFFIC_COLORS = [0xd64541, 0x3f6fb5, 0xe8e6df, 0x555f6b, 0xf2b035, 0x5da271, 0x8e5ea2, 0xc0c6cc, 0x784212];
const TRAFFIC_MODELS = ['comet', 'merit', 'merit', 'hauler', 'rancher', 'taxi'];

const drivers = []; // { car, axis, fixed, dir, cruise }

function laneFor(axis, fixed, dir) {
  // Right-hand traffic: the lane sits to the driver's right of the centre.
  if (axis === 'ns') return fixed + (dir > 0 ? -WORLD.laneOffset : WORLD.laneOffset);
  return fixed + (dir > 0 ? WORLD.laneOffset : -WORLD.laneOffset);
}

function placeOnRoad(driver, nearX, nearZ) {
  const goAvenue = Math.random() < 0.5;
  driver.axis = goAvenue ? 'ns' : 'ew';
  driver.fixed = goAvenue ? pick(WORLD.avenues) : pick(WORLD.streets);
  driver.dir = Math.random() < 0.5 ? 1 : -1;
  const along = rand(-WORLD.half + 40, WORLD.half - 40);
  const lane = laneFor(driver.axis, driver.fixed, driver.dir);
  if (driver.axis === 'ns') {
    driver.car.x = lane;
    driver.car.z = clamp(nearZ + along * 0.4, -WORLD.half + 30, WORLD.half - 30);
    driver.car.heading = driver.dir > 0 ? 0 : Math.PI;
  } else {
    driver.car.x = clamp(nearX + along * 0.4, -WORLD.half + 30, WORLD.half - 30);
    driver.car.z = lane;
    driver.car.heading = driver.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  }
  driver.car.speed = 0;
  driver.cruise = rand(8, 13.5);
}

export function spawnTraffic(scene, count, avoidX, avoidZ) {
  for (let i = 0; i < count; i++) {
    const car = createCar(scene, pick(TRAFFIC_MODELS), pick(TRAFFIC_COLORS), 0, 0, 0);
    car.driver = 'traffic';
    const driver = { car, axis: 'ns', fixed: 0, dir: 1, cruise: 10 };
    placeOnRoad(driver, avoidX + rand(-160, 160), avoidZ + rand(-160, 160));
    if (dist2d(car.x, car.z, avoidX, avoidZ) < 25) placeOnRoad(driver, avoidX + 140, avoidZ + 90);
    drivers.push(driver);
  }
  return drivers.map((d) => d.car);
}

function blockerAhead(driver, blockers) {
  const { car } = driver;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  for (const b of blockers) {
    const dx = b.x - car.x;
    const dz = b.z - car.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < 0.5 || ahead > 8.5) continue;
    const side = Math.abs(dx * fz - dz * fx);
    if (side < 2.1) return ahead;
  }
  return 0;
}

export function updateTraffic(dt, playerPos, blockers) {
  for (const driver of drivers) {
    const { car } = driver;
    if (car.dead) continue;
    const distToPlayer = dist2d(car.x, car.z, playerPos.x, playerPos.z);
    if (distToPlayer > 300) {
      placeOnRoad(driver, playerPos.x, playerPos.z);
      continue;
    }
    // Look ahead along the current lane; near an intersection, sometimes
    // aim into the crossing road so the steering swings the car around it.
    let lookX;
    let lookZ;
    const ahead = 11;
    if (driver.axis === 'ns') {
      lookX = laneFor('ns', driver.fixed, driver.dir);
      lookZ = car.z + driver.dir * ahead;
      for (const s of WORLD.streets) {
        const dz = (s - car.z) * driver.dir;
        if (dz > 2 && dz < ahead + 4 && Math.random() < 0.012) {
          driver.axis = 'ew';
          driver.fixed = s;
          driver.dir = Math.random() < 0.5 ? 1 : -1;
          lookX = car.x + driver.dir * ahead;
          lookZ = laneFor('ew', s, driver.dir);
          break;
        }
      }
    } else {
      lookX = car.x + driver.dir * ahead;
      lookZ = laneFor('ew', driver.fixed, driver.dir);
      for (const a of WORLD.avenues) {
        const dx = (a - car.x) * driver.dir;
        if (dx > 2 && dx < ahead + 4 && Math.random() < 0.012) {
          driver.axis = 'ns';
          driver.fixed = a;
          driver.dir = Math.random() < 0.5 ? 1 : -1;
          lookX = laneFor('ns', a, driver.dir);
          lookZ = car.z + driver.dir * ahead;
          break;
        }
      }
    }
    const desired = Math.atan2(lookX - car.x, lookZ - car.z);
    const steer = clamp(angleDelta(car.heading, desired) * 2.2, -1, 1);
    const blocked = blockerAhead(driver, blockers);
    let throttle = car.speed < driver.cruise ? 0.75 : 0;
    if (blocked) throttle = blocked < 4 ? -0.7 : -0.15;
    const impact = stepCar(car, { throttle, steer, handbrake: false }, dt);
    if (impact > 6) driver.cruise = Math.max(6, driver.cruise - 1);
  }
}

export function trafficCars() {
  return drivers.map((d) => d.car);
}
