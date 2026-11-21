// Solano Heat — entry point. Builds the world, owns the game state machine
// (title / playing / paused / busted-wasted), the camera, driving, and the
// wiring between systems: crimes feed the wanted level, impacts feed damage,
// and everything the player earns or loses lands in the save.

import * as THREE from 'three';
import { WORLD, SPAWN, CASH, COLORS } from './config.js';
import { clamp, dist2d, rand, pick } from './random.js';
import { input, attachInput } from './input.js';
import { unlockAudio, setEngine, setSiren, sfx } from './audio.js';
import { loadSave, storeSave, clearSave, defaultSave } from './savegame.js';
import { buildCity, updateCity } from './city.js';
import { createCar, stepCar, damageCar, flashLightbars } from './vehicles.js';
import { spawnTraffic, updateTraffic, trafficCars } from './traffic.js';
import { spawnPedestrians, updatePedestrians, scarePeds, hurtPed } from './pedestrians.js';
import { initPolice, updatePolice, police } from './police.js';
import { initPlayer, updatePlayer, player, nearestEnterableCar, hurtPlayer, respawnPlayer } from './player.js';
import {
  initMissions, updateMissions, giverInRange, startMission, failMission, missionActive,
  objectiveText, currentMarker, missionSpecialCars, missionsDoneList, nextMissionDef,
} from './missions.js';
import {
  initHud, hudActions, showScreen, setEndScreen, showBriefing, hideBriefing,
  toast, updateHud, drawMinimap,
} from './hud.js';
import { applyShot } from './shots.js';

// ---------------------------------------------------------------- renderer
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// The shadow map is refreshed on demand (see markShadowDirty in the loop):
// the sun follows the player, so it re-renders when the view has moved a
// few metres — not on every frame. That keeps software renderers and weak
// GPUs smooth while shadows still track the action.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(COLORS.fog, 130, 640);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1600);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Sky dome: a canvas gradient (peach horizon to blue zenith) on a big sphere.
{
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#7fb2d9');
  grad.addColorStop(0.45, '#f7c489');
  grad.addColorStop(0.62, '#ffb36b');
  grad.addColorStop(1, '#ff9a5c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(880, 20, 12),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }),
  );
  scene.add(sky);
}

const hemi = new THREE.HemisphereLight(0xffe0b3, 0x51606e, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(COLORS.sun, 1.7);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -105;
sun.shadow.camera.right = 105;
sun.shadow.camera.top = 105;
sun.shadow.camera.bottom = -105;
sun.shadow.camera.far = 480;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);

// ------------------------------------------------------------------- state
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
let save = loadSave() ?? defaultSave();
let cash = save.cash;
let mode = shotName ? 'shot' : 'title';
let briefingDef = null;
let camYaw = SPAWN.heading;
let camOffset = 0;
let elapsed = 0;
let lastHurtAt = -99;
let saveTimer = 0;
let shotCam = null;
const parkedCars = [];
const shotCops = [];

function allCars() {
  const list = [...trafficCars(), ...police.cars(), ...parkedCars, ...missionSpecialCars(), ...shotCops];
  return list.filter((car, i) => list.indexOf(car) === i);
}

// Crime reporting with a witness rule: crimes seen by a pedestrian or a
// police unit count in full; unwitnessed ones mostly slip by.
function reportCrime(points, x, z) {
  let witnessed = police.seeing;
  if (!witnessed) {
    for (const ped of pedsSnapshot) {
      if (dist2d(ped.x, ped.z, x, z) < 26) {
        witnessed = true;
        break;
      }
    }
  }
  police.reportCrime(witnessed ? points : points * 0.3);
}
let pedsSnapshot = [];

function damagePlayer(amount) {
  hurtPlayer(amount);
  lastHurtAt = elapsed;
}

// ------------------------------------------------------------------- world
buildCity(scene);

const PARKED_COLORS = [0xd64541, 0x3f6fb5, 0xe8e6df, 0x555f6b, 0xf2b035, 0x5da271, 0x8e5ea2, 0x21252b];
function spawnParkedCars() {
  // One car beside the spawn point is guaranteed: it is the ride the cover
  // and the first minutes of play revolve around.
  const hero = createCar(scene, 'comet', 0xd64541, 258, 74, Math.PI);
  hero.driver = 'parked';
  parkedCars.push(hero);
  if (save.car) {
    const c = createCar(scene, save.car.model, save.car.color, save.car.x, save.car.z, save.car.heading);
    c.driver = 'parked';
    parkedCars.push(c);
  }
  for (let i = 0; i < 15; i++) {
    const avenue = pick(WORLD.avenues);
    const side = Math.random() < 0.5 ? -1 : 1;
    const car = createCar(
      scene,
      pick(['merit', 'hauler', 'rancher', 'comet', 'taxi']),
      pick(PARKED_COLORS),
      avenue + side * (WORLD.roadWidth / 2 + 2.4),
      rand(-WORLD.half + 30, WORLD.half - 30),
      side > 0 ? Math.PI : 0,
    );
    car.driver = 'parked';
    parkedCars.push(car);
  }
}
spawnParkedCars();
spawnTraffic(scene, 13, SPAWN.x, SPAWN.z);
pedsSnapshot = spawnPedestrians(scene, 22, SPAWN.x, SPAWN.z, (ped, cause) => {
  reportCrime(cause === 'car' ? 55 : 45, ped.x, ped.z);
});
initPolice(scene, 7);
initPlayer(scene, save, {
  onCrime: (points) => reportCrime(points, player.x, player.z),
  onPunchCar: (car) => {
    damageCar(car, 6);
    sfx.crash(0.3);
    reportCrime(16, player.x, player.z);
  },
});
initMissions(scene, save.missionsDone, {
  onCash: (amount) => {
    cash += amount;
    persist();
  },
  onObjective: () => {},
  onMessage: (msg) => toast(msg),
});

// ------------------------------------------------------------------- input
attachInput(window);
hudActions.onNewGame = () => {
  unlockAudio();
  // A clean start needs the world rebuilt from an empty save (missions,
  // cash, parked cars all derive from it at load). If a save or a shot query
  // is in play, clear and reload once; the next click lands in startPlaying
  // with everything already fresh.
  if (loadSave() || window.location.search) {
    clearSave();
    window.location.search = '';
    return;
  }
  startPlaying();
};
hudActions.onContinue = () => {
  unlockAudio();
  startPlaying();
};
hudActions.onResume = () => {
  if (mode === 'paused') {
    mode = 'playing';
    showScreen(null);
  }
};
hudActions.onRestart = () => {
  persist();
  window.location.search = '';
};
hudActions.onRespawn = () => {
  if (mode !== 'end') return;
  mode = 'playing';
  showScreen(null);
};

function startPlaying() {
  mode = 'playing';
  showScreen(null);
  toast(nextMissionDef() ? 'Welcome to Solano City. Follow the gold marker.' : 'Welcome back to Solano City.');
}

function persist() {
  const carToSave = player.car
    ? { x: player.car.x, z: player.car.z, heading: player.car.heading, model: player.car.model, color: 0xd64541 }
    : save.car;
  save = {
    cash,
    missionsDone: missionsDoneList(),
    x: player.x,
    z: player.z,
    heading: player.heading,
    car: carToSave,
  };
  storeSave(save);
}

// ------------------------------------------------------------- end of the line
function endRun(kind) {
  mode = 'end';
  setEngine(false);
  setSiren(false);
  if (player.car) {
    player.car.driver = 'parked';
    player.car = null;
  }
  if (kind === 'BUSTED') {
    const fine = Math.floor(cash * CASH.bustFine);
    cash -= fine;
    setEndScreen('BUSTED', `The SPD impounded your ride and fined you $${fine.toLocaleString('en-US')}. You walk out of the Midtown station.`);
    respawnPlayer(-148, 100, Math.PI / 2);
  } else {
    const fine = Math.min(CASH.wastedFine, cash);
    cash -= fine;
    setEndScreen('WASTED', `Solano General patched you up for $${fine.toLocaleString('en-US')}. The city is still out there.`);
    respawnPlayer(-52, -148, 0);
  }
  police.clear();
  if (missionActive()) failMission(kind === 'BUSTED' ? 'the bust ended it.' : 'it ended in hospital.');
  persist();
  showScreen('end');
}

// ------------------------------------------------------------- interactions
function tryInteract() {
  if (briefingDef) {
    const def = briefingDef;
    briefingDef = null;
    hideBriefing();
    startMission(def);
    toast(`${def.giver}: "${def.title}" — let's move.`);
    return;
  }
  const def = giverInRange(player);
  if (def) {
    briefingDef = def;
    showBriefing(`${def.title} — ${def.giver}`, def.briefing);
    sfx.click();
  }
}

function tryEnterExit() {
  if (player.car) {
    const car = player.car;
    car.driver = 'parked';
    player.car = null;
    const sideX = Math.cos(car.heading);
    const sideZ = -Math.sin(car.heading);
    player.x = car.x + sideX * 2.3;
    player.z = car.z + sideZ * 2.3;
    player.heading = car.heading;
    setEngine(false);
    sfx.door();
    persist();
    return;
  }
  const car = nearestEnterableCar(allCars());
  if (car) {
    car.driver = 'player';
    player.car = car;
    sfx.door();
    setEngine(true, 0);
    if (car.model !== 'interceptor') reportCrime(14, car.x, car.z);
  }
}

// --------------------------------------------------------------- collisions
function separateCars(cars) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d === 0 || d > 3.1) continue;
      const relSpeed = Math.abs(a.speed - b.speed) + Math.abs(a.speed) * 0.3;
      const push = (3.1 - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      if (a.driver !== 'player') { a.x -= nx * push; a.z -= nz * push; }
      if (b.driver !== 'player') { b.x += nx * push; b.z += nz * push; }
      if (a.driver === 'player') { a.x -= nx * push * 0.4; a.z -= nz * push * 0.4; }
      if (b.driver === 'player') { b.x += nx * push * 0.4; b.z += nz * push * 0.4; }
      a.group.position.set(a.x, 0, a.z);
      b.group.position.set(b.x, 0, b.z);
      if (relSpeed > 6) {
        damageCar(a, relSpeed * 0.7);
        damageCar(b, relSpeed * 0.7);
        if (dist2d(player.x, player.z, a.x, a.z) < 30) sfx.crash(0.8);
        if (a.driver === 'player' || b.driver === 'player') reportCrime(15, player.x, player.z);
      }
    }
  }
}

function checkPedestrianHits(cars) {
  for (const car of cars) {
    if (Math.abs(car.speed) < 3.5) continue;
    for (const ped of pedsSnapshot) {
      if (ped.mode === 'down') continue;
      if (dist2d(car.x, car.z, ped.x, ped.z) < 1.5) {
        ped.dangerX = car.x;
        ped.dangerZ = car.z;
        hurtPed(ped, 100, 'car');
        car.speed *= 0.55;
        sfx.crash(0.5);
        scarePeds(car.x, car.z, 12);
      }
    }
    // The player on foot can be clipped by traffic and pursuit cars too.
    if (!player.car && car.driver !== 'player' && dist2d(car.x, car.z, player.x, player.z) < 1.5) {
      damagePlayer(Math.min(34, Math.abs(car.speed) * 1.4));
      player.x += Math.sin(car.heading) * 2.2;
      player.z += Math.cos(car.heading) * 2.2;
      scarePeds(player.x, player.z, 10);
    }
  }
}

// ------------------------------------------------------------------- camera
function updateCamera(dt) {
  if (shotCam) {
    camera.position.set(shotCam.pos.x, shotCam.pos.y, shotCam.pos.z);
    camera.lookAt(shotCam.look.x, shotCam.look.y, shotCam.look.z);
    sun.position.set(shotCam.look.x - 130, 130, shotCam.look.z + 55);
    sun.target.position.set(shotCam.look.x, 0, shotCam.look.z);
    return;
  }
  if (mode === 'title') {
    const t = elapsed * 0.05;
    camera.position.set(Math.sin(t) * 150, 42, Math.cos(t) * 150);
    camera.lookAt(0, 8, 0);
    sun.position.set(-130, 130, 55);
    sun.target.position.set(0, 0, 0);
    return;
  }
  const focus = player.car ?? player;
  const targetHeading = focus.heading;
  const mouse = input.mouseDelta();
  camOffset += mouse.x * 0.0032;
  // The look offset must spring back faster than the camera follows it:
  // the player steers by the camera yaw, so a slow decay turns one mouse
  // flick into a long walking spiral.
  camOffset = clamp(camOffset - camOffset * Math.min(1, dt * 6), -2.6, 2.6);
  let delta = ((targetHeading + camOffset - camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  camYaw += delta * Math.min(1, dt * (player.car ? 3.4 : 5.2));
  const dist = player.car ? 11.5 : 8.6;
  const height = player.car ? 4.1 : 3.1;
  const backX = Math.sin(camYaw) * -dist;
  const backZ = Math.cos(camYaw) * -dist;
  camera.position.set(focus.x + backX, height, focus.z + backZ);
  camera.lookAt(focus.x, 1.5, focus.z);
  // Keep the sun (and its shadow box) centred on the action.
  sun.position.set(focus.x - 130, 130, focus.z + 55);
  sun.target.position.set(focus.x, 0, focus.z);
}

// ------------------------------------------------------- shadow refreshing
const shadowAnchor = new THREE.Vector3(1e9, 0, 1e9);
let shadowTimer = 0;
function markShadowDirty(dt) {
  shadowTimer += dt;
  const focus = player.car ?? player;
  const moved = Math.hypot(focus.x - shadowAnchor.x, focus.z - shadowAnchor.z);
  if (moved > 6 || shadowTimer > 0.6 || mode === 'shot') {
    renderer.shadowMap.needsUpdate = true;
    shadowAnchor.set(focus.x, 0, focus.z);
    shadowTimer = 0;
  }
}

// --------------------------------------------------------------------- loop
function currentPrompt() {
  if (mode !== 'playing') return '';
  if (briefingDef) return 'E — Accept the job';
  const def = giverInRange(player);
  if (def && !player.car) return `E — Talk to ${def.giver}`;
  if (player.car) return 'F — Exit car';
  const car = nearestEnterableCar(allCars());
  if (car) return `F — Drive the ${car.spec.name}`;
  return '';
}

function step(dt) {
  elapsed += dt;
  updateCity(dt, elapsed);
  markShadowDirty(dt);

  if (mode === 'title') {
    const centre = { x: SPAWN.x, z: SPAWN.z };
    updateTraffic(dt, centre, []);
    updatePedestrians(dt, centre);
    updateCamera(dt);
    return;
  }
  if (mode === 'shot') {
    flashLightbars(allCars(), elapsed);
    updateMissions(0, { playerPos: player, playerCar: player.car, stars: 0 }, elapsed);
    updateCamera(dt);
    return;
  }
  if (mode === 'paused' && (input.justPressed('KeyP') || input.justPressed('Escape'))) {
    mode = 'playing';
    showScreen(null);
    updateCamera(dt);
    return;
  }
  if (mode !== 'playing') {
    updateCamera(dt);
    return;
  }

  // Pause and interactions first, so a keypress lands the frame it happens.
  if (input.justPressed('KeyP') || input.justPressed('Escape')) {
    mode = 'paused';
    showScreen('pause');
    setEngine(false);
    return;
  }
  if (input.justPressed('KeyE')) tryInteract();
  if (input.justPressed('KeyF')) tryEnterExit();
  if (briefingDef && dist2d(player.x, player.z, briefingDef.giverPos.x, briefingDef.giverPos.z) > 5) {
    briefingDef = null;
    hideBriefing();
  }

  // The player: on foot, or driving the car they are in.
  const cars = allCars();
  if (player.car) {
    const axes = input.moveAxes();
    const impact = stepCar(player.car, {
      throttle: -axes.z,
      steer: axes.x,
      handbrake: input.handbrake(),
    }, dt);
    if (impact > 7) {
      damagePlayer(impact * 0.35);
      reportCrime(12, player.x, player.z);
    }
    player.x = player.car.x;
    player.z = player.car.z;
    setEngine(true, Math.abs(player.car.speed) / player.car.spec.topSpeed);
  }
  updatePlayer(dt, camYaw, cars);

  // The city around them.
  const blockers = cars.map((c) => ({ x: c.x, z: c.z }));
  if (!player.car) blockers.push({ x: player.x, z: player.z });
  updateTraffic(dt, player, blockers);
  updatePedestrians(dt, player);
  separateCars(cars);
  checkPedestrianHits(cars.filter((c) => c.driver !== 'parked'));

  // Police and consequences.
  const focus = player.car ?? player;
  const target = {
    x: focus.x,
    z: focus.z,
    vx: player.car ? Math.sin(player.car.heading) * player.car.speed : 0,
    vz: player.car ? Math.cos(player.car.heading) * player.car.speed : 0,
    speed: player.car ? player.car.speed : player.speedNow,
    inCar: Boolean(player.car),
  };
  const policeResult = updatePolice(dt, target, elapsed);
  const anyCopNear = police.cars().some((c) => dist2d(c.x, c.z, player.x, player.z) < 42);
  setSiren(police.stars > 0 && anyCopNear);
  if (policeResult.bust) {
    endRun('BUSTED');
    return;
  }
  if (player.health <= 0) {
    endRun('WASTED');
    return;
  }
  if (elapsed - lastHurtAt > 6 && player.health > 0) {
    player.health = Math.min(100, player.health + 2.6 * dt);
  }

  updateMissions(dt, { playerPos: player, playerCar: player.car, stars: police.stars }, elapsed);

  saveTimer += dt;
  if (saveTimer > 5) {
    saveTimer = 0;
    persist();
  }

  // HUD.
  updateHud({
    cash,
    stars: police.stars,
    health: player.car ? player.car.health : player.health,
    objective: objectiveText(),
    prompt: currentPrompt(),
    speedKmh: player.car ? Math.abs(player.car.speed) * 3.6 : null,
    bust: police.bustProgress,
  });
  drawMinimap({
    playerPos: player,
    heading: focus.heading,
    cars: [...trafficCars(), ...parkedCars],
    cops: police.cars(),
    marker: currentMarker(),
    elapsed,
  });
  updateCamera(dt);
}

// -------------------------------------------------------------- shot scenes
// The HUD elements must be collected before any scene touches them: the
// shot block below already writes cash, stars and briefings to the DOM.
initHud();
if (shotName) {
  const ctx = {
    spawnCar: (model, color, x, z, heading) => {
      const car = createCar(scene, model, color, x, z, heading);
      car.driver = 'parked';
      parkedCars.push(car);
      return car;
    },
    placePlayer: (x, z, heading) => {
      player.x = x;
      player.z = z;
      player.heading = heading;
    },
    enterCar: (car) => {
      car.driver = 'player';
      player.car = car;
    },
    setWanted: (points) => police.reportCrime(points),
    placeCop: (x, z, heading) => {
      const car = createCar(scene, 'interceptor', 0x15181d, x, z, heading);
      car.driver = 'police';
      shotCops.push(car);
      return car;
    },
    setCamera: (pos, look) => {
      shotCam = { pos, look };
    },
    openBriefing: () => {
      const def = nextMissionDef();
      if (def) showBriefing(`${def.title} — ${def.giver}`, def.briefing);
    },
  };
  applyShot(ctx, shotName);
  // A few ambient cars and people so no scene looks staged-empty.
  updateHud({
    cash,
    stars: shotName === 'chase' ? 3 : 0,
    health: 100,
    objective: shotName === 'mission' ? objectiveText() : shotName === 'chase' ? 'Lose the cops!' : 'Free roam — follow the gold marker',
    prompt: '',
    speedKmh: shotName === 'chase' ? 61 : null,
    bust: 0,
  });
  drawMinimap({
    playerPos: player,
    heading: player.heading,
    cars: [...trafficCars(), ...parkedCars],
    cops: shotCops,
    marker: currentMarker(),
    elapsed: 1,
  });
}

// --------------------------------------------------------------------- boot
if (!shotName) showScreen('title', Boolean(loadSave()));
const clock = new THREE.Clock();
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  step(dt);
  input.endFrame();
  renderer.render(scene, camera);
  frames++;
  if (frames === 4) {
    window.__solano = {
      ready: true,
      mode: () => mode,
      player,
      police,
      cash: () => cash,
      startPlaying,
      objective: () => objectiveText(),
      debug: { renderer, scene, camera },
    };
  }
}
loop();
