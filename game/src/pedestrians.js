// Pedestrians: low-poly people who stroll the sidewalks block by block,
// run from danger, and go down when a car or a fist finds them. Events are
// reported through callbacks so the wanted system can react.

import * as THREE from 'three';
import { WORLD } from './config.js';
import { rand, randInt, pick, clamp, angleDelta, dist2d } from './random.js';
import { collideCircle } from './city.js';

const SHIRTS = [0xef5350, 0x42a5f5, 0xffee58, 0x66bb6a, 0xab47bc, 0xffa726, 0xec407a, 0x26c6da, 0xf5f5f5];
const PANTS = [0x37474f, 0x5d4037, 0x283593, 0x212121, 0x6d4c41];
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];

const peds = [];
let onDown = () => {};

// Block rectangles (sidewalk loops) derived from the same grid as the city.
const blocks = [];
{
  const xs = [-WORLD.half, ...WORLD.avenues, WORLD.half];
  const zs = [-WORLD.half, ...WORLD.streets, WORLD.half];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2;
      const cz = (zs[j] + zs[j + 1]) / 2;
      if (cx > WORLD.beachX - 26) continue;
      const hw = (xs[i + 1] - xs[i]) / 2 - WORLD.roadWidth / 2 - 1.6;
      const hd = (zs[j + 1] - zs[j]) / 2 - WORLD.roadWidth / 2 - 1.6;
      if (hw > 6 && hd > 6) blocks.push({ cx, cz, hw, hd });
    }
  }
}

function buildPerson() {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: pick(SHIRTS) });
  const pants = new THREE.MeshLambertMaterial({ color: pick(PANTS) });
  const skin = new THREE.MeshLambertMaterial({ color: pick(SKIN) });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.28), shirt);
  torso.position.y = 1.06;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), skin);
  head.position.y = 1.58;
  group.add(head);
  const limbs = {};
  const mkLimb = (mat, w, h, x, y) => {
    const geo = new THREE.BoxGeometry(w, h, w);
    geo.translate(0, -h / 2, 0); // pivot at the shoulder / hip
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    group.add(m);
    return m;
  };
  limbs.armL = mkLimb(shirt, 0.13, 0.58, -0.34, 1.32);
  limbs.armR = mkLimb(shirt, 0.13, 0.58, 0.34, 1.32);
  limbs.legL = mkLimb(pants, 0.16, 0.78, -0.13, 0.78);
  limbs.legR = mkLimb(pants, 0.16, 0.78, 0.13, 0.78);
  return { group, limbs };
}

function cornerOf(block, idx) {
  const sx = idx === 0 || idx === 3 ? -1 : 1;
  const sz = idx < 2 ? -1 : 1;
  return { x: block.cx + sx * block.hw, z: block.cz + sz * block.hd };
}

export function spawnPedestrians(scene, count, centerX, centerZ, callback) {
  onDown = callback || onDown;
  for (let i = 0; i < count; i++) {
    const { group, limbs } = buildPerson();
    scene.add(group);
    const block = pick(blocks);
    const ped = {
      group,
      limbs,
      x: block.cx + rand(-block.hw, block.hw),
      z: block.cz - block.hd,
      heading: rand(0, Math.PI * 2),
      speed: rand(1.1, 1.9),
      block,
      corner: randInt(0, 3),
      mode: 'walk', // walk | flee | down
      modeTime: 0,
      dangerX: 0,
      dangerZ: 0,
      walkPhase: rand(0, 6),
      health: 60,
    };
    if (dist2d(ped.x, ped.z, centerX, centerZ) > 200) {
      ped.x = centerX + rand(-70, 70);
      ped.z = centerZ + rand(-70, 70);
    }
    peds.push(ped);
  }
  return peds;
}

export function scarePeds(x, z, radius) {
  for (const ped of peds) {
    if (ped.mode === 'down') continue;
    if (dist2d(ped.x, ped.z, x, z) < radius) {
      ped.mode = 'flee';
      ped.modeTime = rand(1.6, 3.2);
      ped.dangerX = x;
      ped.dangerZ = z;
    }
  }
}

export function hurtPed(ped, amount, cause) {
  if (ped.mode === 'down') return;
  ped.health -= amount;
  if (ped.health <= 0) {
    ped.mode = 'down';
    ped.modeTime = 7;
    onDown(ped, cause);
  } else {
    ped.mode = 'flee';
    ped.modeTime = 2.4;
    ped.dangerX = ped.x + rand(-4, 4);
    ped.dangerZ = ped.z - 6;
  }
}

export function pedsNear(x, z, radius) {
  return peds.filter((p) => p.mode !== 'down' && dist2d(p.x, p.z, x, z) < radius);
}

export function updatePedestrians(dt, playerPos) {
  for (const ped of peds) {
    // Keep the sidewalks populated near the player.
    if (dist2d(ped.x, ped.z, playerPos.x, playerPos.z) > 260 && ped.mode !== 'down') {
      const block = pick(blocks);
      ped.block = block;
      ped.x = clamp(playerPos.x + rand(-90, 90), -WORLD.half + 12, WORLD.beachX - 8);
      ped.z = clamp(playerPos.z + rand(-90, 90), -WORLD.half + 12, WORLD.half - 12);
    }
    let targetSpeed = 0;
    if (ped.mode === 'down') {
      ped.modeTime -= dt;
      ped.group.rotation.x = Math.max(-Math.PI / 2, ped.group.rotation.x - dt * 6);
      ped.group.position.set(ped.x, 0.25, ped.z);
      if (ped.modeTime <= 0) {
        ped.mode = 'flee';
        ped.modeTime = 2;
        ped.health = 60;
        ped.group.rotation.x = 0;
        ped.dangerX = playerPos.x;
        ped.dangerZ = playerPos.z;
      }
      continue;
    }
    ped.group.rotation.x = 0;
    let tx;
    let tz;
    if (ped.mode === 'flee') {
      ped.modeTime -= dt;
      const away = Math.atan2(ped.x - ped.dangerX, ped.z - ped.dangerZ);
      tx = ped.x + Math.sin(away) * 8;
      tz = ped.z + Math.cos(away) * 8;
      targetSpeed = 6.2;
      if (ped.modeTime <= 0) ped.mode = 'walk';
    } else {
      const corner = cornerOf(ped.block, ped.corner);
      tx = corner.x;
      tz = corner.z;
      targetSpeed = ped.speed;
      if (dist2d(ped.x, ped.z, tx, tz) < 1.2) {
        ped.corner = (ped.corner + 1) % 4;
        if (Math.random() < 0.14) ped.block = pick(blocks); // cross to a new block
      }
    }
    const desired = Math.atan2(tx - ped.x, tz - ped.z);
    ped.heading += clamp(angleDelta(ped.heading, desired), -3.4 * dt, 3.4 * dt);
    ped.x += Math.sin(ped.heading) * targetSpeed * dt;
    ped.z += Math.cos(ped.heading) * targetSpeed * dt;
    const pos = { x: ped.x, z: ped.z };
    collideCircle(pos, 0.35);
    ped.x = pos.x;
    ped.z = pos.z;
    ped.walkPhase += dt * targetSpeed * 2.4;
    const swing = Math.sin(ped.walkPhase) * (targetSpeed > 3 ? 0.65 : 0.4);
    ped.limbs.armL.rotation.x = swing;
    ped.limbs.armR.rotation.x = -swing;
    ped.limbs.legL.rotation.x = -swing;
    ped.limbs.legR.rotation.x = swing;
    ped.group.position.set(ped.x, Math.abs(Math.sin(ped.walkPhase)) * 0.05, ped.z);
    ped.group.rotation.y = ped.heading;
  }
}

export function allPeds() {
  return peds;
}
