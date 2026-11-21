// The player on foot: a third-person character who walks, sprints, punches,
// and gets in and out of cars. While driving, main.js steps the car instead
// and this module just keeps the character seated in it.

import * as THREE from 'three';
import { PLAYER, WORLD } from './config.js';
import { input } from './input.js';
import { clamp, angleDelta, dist2d } from './random.js';
import { collideCircle } from './city.js';
import { pedsNear, hurtPed, scarePeds } from './pedestrians.js';
import { sfx } from './audio.js';

export const player = {
  x: 0,
  z: 0,
  heading: 0,
  health: PLAYER.maxHealth,
  car: null,
  punchTimer: 0,
  walkPhase: 0,
  speedNow: 0,
  group: null,
  limbs: null,
};

let onCrime = () => {};
let onPunchCar = () => {};

function buildFigure() {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: 0x26a69a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x37474f });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0ac69 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.64, 0.3), shirt);
  torso.position.y = 1.07;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), skin);
  head.position.y = 1.6;
  group.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.1, 10), new THREE.MeshLambertMaterial({ color: 0xef5350 }));
  cap.position.y = 1.74;
  group.add(cap);
  const mk = (mat, w, h, x, y) => {
    const geo = new THREE.BoxGeometry(w, h, w);
    geo.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    group.add(m);
    return m;
  };
  return {
    group,
    limbs: {
      armL: mk(shirt, 0.14, 0.6, -0.35, 1.34),
      armR: mk(shirt, 0.14, 0.6, 0.35, 1.34),
      legL: mk(pants, 0.17, 0.8, -0.14, 0.8),
      legR: mk(pants, 0.17, 0.8, 0.14, 0.8),
    },
  };
}

export function initPlayer(scene, save, callbacks) {
  const { group, limbs } = buildFigure();
  scene.add(group);
  player.group = group;
  player.limbs = limbs;
  player.x = save.x;
  player.z = save.z;
  player.heading = save.heading;
  onCrime = callbacks.onCrime || onCrime;
  onPunchCar = callbacks.onPunchCar || onPunchCar;
  syncFigure(0);
}

function syncFigure(dt) {
  if (!player.group) return;
  if (player.car) {
    player.group.visible = false;
    return;
  }
  player.group.visible = true;
  player.group.position.set(player.x, Math.abs(Math.sin(player.walkPhase)) * 0.05, player.z);
  player.group.rotation.y = player.heading;
  const swing = Math.sin(player.walkPhase) * clamp(player.speedNow / PLAYER.walkSpeed, 0, 1) * 0.55;
  player.limbs.legL.rotation.x = -swing;
  player.limbs.legR.rotation.x = swing;
  if (player.punchTimer > 0.14) {
    player.limbs.armR.rotation.x = -1.9; // fist out
    player.limbs.armL.rotation.x = swing * 0.4;
  } else {
    player.limbs.armR.rotation.x = -swing;
    player.limbs.armL.rotation.x = swing;
  }
}

// Try to punch whatever is in front. Returns true if a punch was thrown.
export function tryPunch(cars) {
  if (player.punchTimer > 0 || player.car) return false;
  player.punchTimer = PLAYER.punchCooldown;
  sfx.punch();
  const fx = Math.sin(player.heading);
  const fz = Math.cos(player.heading);
  let hitSomething = false;
  for (const ped of pedsNear(player.x, player.z, PLAYER.punchRange + 0.4)) {
    const dx = ped.x - player.x;
    const dz = ped.z - player.z;
    if (dx * fx + dz * fz > 0.2) {
      hurtPed(ped, PLAYER.punchDamage, 'assault');
      hitSomething = true;
    }
  }
  for (const car of cars) {
    if (dist2d(car.x, car.z, player.x, player.z) < PLAYER.punchRange + 1.4) {
      onPunchCar(car);
      hitSomething = true;
    }
  }
  if (hitSomething) scarePeds(player.x, player.z, 7);
  return true;
}

export function nearestEnterableCar(cars) {
  let best = null;
  let bestD = 3.1;
  for (const car of cars) {
    if (car.driver === 'traffic' || car.driver === 'police' || car.driver === 'target') continue;
    const d = dist2d(car.x, car.z, player.x, player.z);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

export function updatePlayer(dt, cameraYaw, cars) {
  if (player.punchTimer > 0) player.punchTimer -= dt;
  if (player.car) {
    player.x = player.car.x;
    player.z = player.car.z;
    player.heading = player.car.heading;
    player.speedNow = Math.abs(player.car.speed);
    syncFigure(dt);
    return;
  }
  const axes = input.moveAxes();
  const moving = axes.x !== 0 || axes.z !== 0;
  const speed = input.sprint() ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  player.speedNow = moving ? speed : 0;
  if (moving) {
    // Input axes are screen-style (W = z -1, D = x +1); negating both turns
    // them into a world heading offset, so W walks away from the camera
    // (moveAngle = cameraYaw) instead of into it.
    const moveAngle = Math.atan2(-axes.x, -axes.z) + cameraYaw;
    const delta = angleDelta(player.heading, moveAngle);
    player.heading += clamp(delta, -PLAYER.turnRate * dt, PLAYER.turnRate * dt);
    player.x += Math.sin(moveAngle) * speed * dt;
    player.z += Math.cos(moveAngle) * speed * dt;
    player.walkPhase += dt * speed * 1.9;
  }
  const pos = { x: player.x, z: player.z };
  collideCircle(pos, PLAYER.radius);
  player.x = clamp(pos.x, -WORLD.half + 1, WORLD.half - 1);
  player.z = clamp(pos.z, -WORLD.half + 1, WORLD.half - 1);
  if ((input.justPressed('Space') || input.justPressed('KeyJ')) && !player.car) tryPunch(cars);
  syncFigure(dt);
}

export function hurtPlayer(amount) {
  player.health = clamp(player.health - amount, 0, PLAYER.maxHealth);
  if (amount > 4) sfx.hurt();
}

export function respawnPlayer(x, z, heading) {
  player.x = x;
  player.z = z;
  player.heading = heading;
  player.health = PLAYER.maxHealth;
  player.car = null;
  syncFigure(0);
}
