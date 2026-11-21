// The story: five missions from three contacts across Solano City.
// Marisol Vega runs packages out of Coral Beach, Danny Okafor fences cars at
// Port Solano, and Rosa Delgado launders money through a Midtown gallery.
// Each mission is a small state machine; this module owns the givers, the
// objective beacons and the stage logic, and reports money and messages
// through callbacks wired in main.js.

import * as THREE from 'three';
import { WORLD } from './config.js';
import { dist2d, clamp, angleDelta } from './random.js';
import { createCar, stepCar } from './vehicles.js';
import { police } from './police.js';
import { sfx } from './audio.js';

export const MISSION_DEFS = [
  {
    id: 'beach-run',
    title: 'Beach Run',
    giver: 'Marisol Vega',
    giverPos: { x: 246, z: 44 },
    reward: 450,
    type: 'deliver',
    briefing: 'A cooler came off a boat at the port. Pick it up at the dock gates, bring it to the Palm Heights overlook. No questions, no stops.',
    pickup: { x: -252, z: 252 },
    dropoff: { x: -252, z: -252 },
  },
  {
    id: 'hot-metal',
    title: 'Hot Metal',
    giver: 'Danny Okafor',
    giverPos: { x: -252, z: 236 },
    reward: 700,
    type: 'steal',
    briefing: 'A gold Comet GT is parked behind the Downtown tower row. Take it, and bring it to my garage at the port. Intact, if you can manage that.',
    carPos: { x: 12, z: -108 },
    dropoff: { x: -236, z: 252 },
  },
  {
    id: 'night-freight',
    title: 'Night Freight',
    giver: 'Marisol Vega',
    giverPos: { x: 246, z: 44 },
    reward: 850,
    type: 'checkpoints',
    briefing: 'Four drops, one loop of the city, against the clock. Hit every marker before the time runs out and the freight is yours.',
    points: [
      { x: 100, z: -236 },
      { x: -124, z: -60 },
      { x: -236, z: 116 },
      { x: 116, z: 196 },
    ],
    timeLimit: 150,
  },
  {
    id: 'heat-escape',
    title: 'Heat Escape',
    giver: 'Rosa Delgado',
    giverPos: { x: -44, z: 116 },
    reward: 1000,
    type: 'escape',
    briefing: 'My courier van gets searched at noon unless the SPD is busy elsewhere. Make some noise, draw the heat, then disappear. That is the whole job.',
  },
  {
    id: 'last-score',
    title: 'Last Score',
    giver: 'Danny Okafor',
    giverPos: { x: -252, z: 236 },
    reward: 1500,
    type: 'target',
    briefing: 'A rival crew is moving product in a black Rancher. Stop the truck — hard — then get yourself to the Coral Beach hideout.',
    targetSpawn: { x: 60, z: 260 },
    hideout: { x: 246, z: -196 },
  },
];

let sceneRef = null;
let callbacks = { onCash: () => {}, onObjective: () => {}, onMessage: () => {} };
let doneIds = [];
let active = null; // { def, stage, data }
const giverFigures = [];
let beacon = null;
let beaconRing = null;
let specialCar = null;
let targetCar = null;
let targetDriver = null;

function makeBeacon(color) {
  const group = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  beam.position.y = 13;
  group.add(beam);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.14, 8, 28),
    new THREE.MeshBasicMaterial({ color }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.25;
  group.add(ring);
  group.visible = false;
  return { group, ring };
}

function makeGiverFigure(x, z, color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.64, 0.3), mat);
  torso.position.y = 1.07;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshLambertMaterial({ color: 0xc68642 }));
  head.position.y = 1.6;
  group.add(head);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.78, 0.26), new THREE.MeshLambertMaterial({ color: 0x263238 }));
  legs.position.y = 0.39;
  group.add(legs);
  group.position.set(x, 0, z);
  group.rotation.y = Math.PI / 2;
  return group;
}

export function initMissions(scene, done, cb) {
  sceneRef = scene;
  doneIds = done.slice();
  callbacks = cb;
  const colors = [0xffca28, 0x26c6da, 0xef5350];
  MISSION_DEFS.forEach((def, i) => {
    const fig = makeGiverFigure(def.giverPos.x, def.giverPos.z, colors[i % colors.length]);
    scene.add(fig);
    giverFigures.push(fig);
  });
  beacon = makeBeacon(0x29b6f6);
  scene.add(beacon.group);
}

export function nextMissionDef() {
  return MISSION_DEFS.find((d) => !doneIds.includes(d.id)) ?? null;
}

export function giverInRange(playerPos) {
  if (active) return null;
  const def = nextMissionDef();
  if (!def) return null;
  return dist2d(playerPos.x, playerPos.z, def.giverPos.x, def.giverPos.z) < 3.4 ? def : null;
}

export function startMission(def) {
  active = { def, stage: 0, data: {} };
  if (def.type === 'checkpoints') {
    active.data.timeLeft = def.timeLimit;
    active.data.index = 0;
  }
  if (def.type === 'steal') {
    specialCar = createCar(sceneRef, 'comet', 0xd4af37, def.carPos.x, def.carPos.z, Math.PI / 2);
    specialCar.driver = 'parked';
  }
  if (def.type === 'escape') {
    police.reportCrime(210); // two stars of noise, as agreed with Rosa
  }
  if (def.type === 'target') {
    targetCar = createCar(sceneRef, 'rancher', 0x101216, def.targetSpawn.x, def.targetSpawn.z, 0);
    targetCar.driver = 'target';
    targetDriver = { axis: 'ew', fixed: def.targetSpawn.z, dir: 1 };
  }
  sfx.chime();
  announceObjective();
}

function announceObjective() {
  callbacks.onObjective(objectiveText());
}

function finishMission() {
  const def = active.def;
  doneIds.push(def.id);
  callbacks.onCash(def.reward, def.title);
  callbacks.onMessage(`Mission complete — ${def.title} (+$${def.reward})`);
  sfx.cash();
  active = null;
  specialCar = null;
  targetCar = null;
  announceObjective();
}

export function failMission(reason) {
  if (!active) return;
  callbacks.onMessage(`Mission failed — ${reason}`);
  sfx.fail();
  active = null;
  targetCar = null;
  announceObjective();
}

export function missionActive() {
  return active !== null;
}

export function objectiveText() {
  const next = nextMissionDef();
  if (!active) {
    if (!next) return 'Story complete — Solano City is yours. Free roam!';
    return `Find ${next.giver} to start "${next.title}"`;
  }
  const { def, stage, data } = active;
  switch (def.type) {
    case 'deliver':
      return stage === 0 ? `${def.title}: pick up the cooler at the Port Solano dock` : `${def.title}: deliver the cooler to the Palm Heights overlook`;
    case 'steal':
      return stage === 0 ? `${def.title}: steal the gold Comet GT in Downtown` : `${def.title}: deliver the Comet to Danny's garage at the port`;
    case 'checkpoints':
      return `${def.title}: hit marker ${data.index + 1} of ${def.points.length} — ${Math.max(0, Math.ceil(data.timeLeft))}s left`;
    case 'escape':
      return stage === 0 ? `${def.title}: draw the heat (reach 2 stars)` : `${def.title}: lose the cops — break their line of sight`;
    case 'target':
      return stage === 0 ? `${def.title}: stop the black Rancher` : `${def.title}: reach the Coral Beach hideout`;
    default:
      return def.title;
  }
}

export function currentMarker() {
  if (!active) {
    const next = nextMissionDef();
    return next ? { x: next.giverPos.x, z: next.giverPos.z, color: 0xffca28 } : null;
  }
  const { def, stage, data } = active;
  switch (def.type) {
    case 'deliver':
      return stage === 0 ? { ...def.pickup, color: 0x29b6f6 } : { ...def.dropoff, color: 0x29b6f6 };
    case 'steal':
      return stage === 0 && specialCar ? { x: specialCar.x, z: specialCar.z, color: 0x29b6f6 } : { ...def.dropoff, color: 0x29b6f6 };
    case 'checkpoints':
      return { ...def.points[data.index], color: 0x29b6f6 };
    case 'escape':
      return null; // nowhere to go but out of sight
    case 'target':
      return stage === 0 && targetCar ? { x: targetCar.x, z: targetCar.z, color: 0xef5350 } : { ...def.hideout, color: 0x29b6f6 };
    default:
      return null;
  }
}

function driveTarget(dt, playerPos) {
  // The rival driver cruises the roads and speeds up when the player closes
  // in, turning at intersections much like the civilian traffic does.
  if (!targetCar || targetCar.dead) return;
  const car = targetCar;
  const d = dist2d(car.x, car.z, playerPos.x, playerPos.z);
  const cruise = d < 55 ? 17 : 10;
  let lookX;
  let lookZ;
  if (targetDriver.axis === 'ew') {
    lookX = car.x + targetDriver.dir * 12;
    lookZ = targetDriver.fixed + (targetDriver.dir > 0 ? WORLD.laneOffset : -WORLD.laneOffset);
    for (const a of WORLD.avenues) {
      if (Math.abs(a - car.x) < 3 && Math.random() < 0.05) {
        targetDriver = { axis: 'ns', fixed: a, dir: Math.random() < 0.5 ? 1 : -1 };
        break;
      }
    }
  } else {
    lookX = targetDriver.fixed + (targetDriver.dir > 0 ? -WORLD.laneOffset : WORLD.laneOffset);
    lookZ = car.z + targetDriver.dir * 12;
    for (const s of WORLD.streets) {
      if (Math.abs(s - car.z) < 3 && Math.random() < 0.05) {
        targetDriver = { axis: 'ew', fixed: s, dir: Math.random() < 0.5 ? 1 : -1 };
        break;
      }
    }
  }
  const desired = Math.atan2(lookX - car.x, lookZ - car.z);
  const steer = clamp(angleDelta(car.heading, desired) * 2.2, -1, 1);
  stepCar(car, { throttle: car.speed < cruise ? 0.85 : 0, steer, handbrake: false }, dt);
}

export function updateMissions(dt, ctx, elapsed) {
  // Animate the giver figures with a gentle bob so they read as people.
  giverFigures.forEach((fig, i) => {
    fig.position.y = Math.sin(elapsed * 1.6 + i * 2.1) * 0.03;
  });
  const marker = currentMarker();
  if (marker) {
    beacon.group.visible = true;
    beacon.group.position.set(marker.x, 0, marker.z);
    beacon.ring.material.color.setHex(marker.color);
    beacon.ring.scale.setScalar(1 + Math.sin(elapsed * 3.2) * 0.12);
  } else {
    beacon.group.visible = false;
  }
  if (!active) return;
  const { def } = active;
  const p = ctx.playerPos;
  const reach = ctx.playerCar ? 6.5 : 3.2;

  if (def.type === 'deliver') {
    const target = active.stage === 0 ? def.pickup : def.dropoff;
    if (dist2d(p.x, p.z, target.x, target.z) < reach) {
      if (active.stage === 0) {
        active.stage = 1;
        callbacks.onMessage('Got the cooler. Now the overlook — move.');
        sfx.chime();
        announceObjective();
      } else finishMission();
    }
  } else if (def.type === 'steal') {
    if (active.stage === 0 && specialCar && ctx.playerCar === specialCar) {
      active.stage = 1;
      callbacks.onMessage('That is the car. Get it to the port.');
      announceObjective();
    } else if (active.stage === 1 && ctx.playerCar === specialCar && dist2d(p.x, p.z, def.dropoff.x, def.dropoff.z) < 8) {
      specialCar.driver = 'parked';
      finishMission();
    }
  } else if (def.type === 'checkpoints') {
    active.data.timeLeft -= dt;
    if (active.data.timeLeft <= 0) {
      failMission('the clock ran out. Talk to Marisol to try again.');
      return;
    }
    const point = def.points[active.data.index];
    if (dist2d(p.x, p.z, point.x, point.z) < 9) {
      active.data.index++;
      active.data.timeLeft += 12;
      sfx.chime();
      if (active.data.index >= def.points.length) finishMission();
      else announceObjective();
    }
  } else if (def.type === 'escape') {
    if (active.stage === 0 && ctx.stars >= 2) {
      active.stage = 1;
      callbacks.onMessage('They are watching. Now vanish.');
      announceObjective();
    } else if (active.stage === 1 && ctx.stars === 0) {
      finishMission();
    }
  } else if (def.type === 'target') {
    if (active.stage === 0) {
      driveTarget(dt, p);
      if (targetCar && targetCar.dead) {
        active.stage = 1;
        callbacks.onMessage('The Rancher is done. Hideout, now.');
        announceObjective();
      }
    } else if (dist2d(p.x, p.z, def.hideout.x, def.hideout.z) < reach + 2) {
      finishMission();
    }
  }
}

export function missionSpecialCars() {
  const cars = [];
  if (specialCar) cars.push(specialCar);
  if (targetCar) cars.push(targetCar);
  return cars;
}

export function missionsDoneList() {
  return doneIds.slice();
}
