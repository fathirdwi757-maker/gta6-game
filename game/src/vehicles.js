// Cars: a small factory of original models built from boxes and cylinders,
// and one arcade physics step shared by the player, traffic and police so
// every car on the road handles the same way.

import * as THREE from 'three';
import { CAR } from './config.js';
import { clamp } from './random.js';
import { collideCircle } from './city.js';

export const CAR_MODELS = {
  comet: { name: 'Comet GT', w: 1.9, l: 4.3, h: 0.62, cabin: 0.5, topSpeed: 34, accel: 19 },
  merit: { name: 'Merit Sedan', w: 1.85, l: 4.6, h: 0.72, cabin: 0.55, topSpeed: 27, accel: 15 },
  hauler: { name: 'Hauler Van', w: 2.0, l: 5.0, h: 1.25, cabin: 0.65, topSpeed: 23, accel: 12 },
  rancher: { name: 'Rancher Pickup', w: 1.95, l: 4.9, h: 0.85, cabin: 0.6, topSpeed: 25, accel: 14 },
  taxi: { name: 'Solano Cab', w: 1.85, l: 4.6, h: 0.72, cabin: 0.55, topSpeed: 27, accel: 15 },
  interceptor: { name: 'SPD Interceptor', w: 1.9, l: 4.7, h: 0.7, cabin: 0.55, topSpeed: 31, accel: 18 },
};

const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x20303c });
const lightMat = new THREE.MeshLambertMaterial({ color: 0xfff6c9, emissive: 0xffec9e, emissiveIntensity: 0.7 });
const tailMat = new THREE.MeshLambertMaterial({ color: 0xb71c1c, emissive: 0x7f0000, emissiveIntensity: 0.6 });

function buildBody(model, colorHex) {
  const spec = CAR_MODELS[model];
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: colorHex });
  const body = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.l), paint);
  body.position.y = 0.38 + spec.h / 2;
  body.castShadow = true;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(spec.w * 0.82, spec.cabin, spec.l * 0.44), glassMat);
  cabin.position.set(0, 0.38 + spec.h + spec.cabin / 2 - 0.04, -spec.l * 0.05);
  cabin.castShadow = true;
  group.add(cabin);
  if (model === 'comet') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(spec.w * 0.94, 0.07, 0.4), paint);
    spoiler.position.set(0, 1.18, -spec.l / 2 + 0.25);
    group.add(spoiler);
  }
  if (model === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), new THREE.MeshLambertMaterial({ color: 0xffd54f, emissive: 0xffb300, emissiveIntensity: 0.5 }));
    sign.position.set(0, 0.38 + spec.h + spec.cabin + 0.1, -spec.l * 0.05);
    group.add(sign);
  }
  const wheels = [];
  const wx = spec.w / 2 - 0.05;
  const wz = spec.l / 2 - 0.85;
  for (const [x, z] of [[-wx, wz], [wx, wz], [-wx, -wz], [wx, -wz]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.36, z);
    group.add(wheel);
    wheels.push(wheel);
  }
  const hl = new THREE.Mesh(new THREE.BoxGeometry(spec.w * 0.7, 0.14, 0.06), lightMat);
  hl.position.set(0, 0.72, spec.l / 2 + 0.01);
  group.add(hl);
  const tl = new THREE.Mesh(new THREE.BoxGeometry(spec.w * 0.7, 0.12, 0.06), tailMat);
  tl.position.set(0, 0.78, -spec.l / 2 - 0.01);
  group.add(tl);
  let lightbar = null;
  if (model === 'interceptor') {
    lightbar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.34), new THREE.MeshLambertMaterial({ color: 0xff1744, emissive: 0xff1744, emissiveIntensity: 1 }));
    red.position.x = -0.3;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.34), new THREE.MeshLambertMaterial({ color: 0x2979ff, emissive: 0x2979ff, emissiveIntensity: 1 }));
    blue.position.x = 0.3;
    lightbar.add(red, blue);
    lightbar.position.set(0, 0.38 + spec.h + spec.cabin + 0.08, -spec.l * 0.05);
    lightbar.userData = { red, blue };
    group.add(lightbar);
    // White doors on the black Interceptor paint job.
    const door = new THREE.Mesh(new THREE.BoxGeometry(spec.w + 0.02, spec.h * 0.7, spec.l * 0.34), new THREE.MeshLambertMaterial({ color: 0xf5f5f5 }));
    door.position.set(0, 0.38 + spec.h / 2, 0.1);
    group.add(door);
  }
  return { group, wheels, lightbar };
}

let nextCarId = 1;

export function createCar(scene, model, colorHex, x, z, heading) {
  const { group, wheels, lightbar } = buildBody(model, colorHex);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  return {
    id: nextCarId++,
    model,
    spec: CAR_MODELS[model],
    group,
    wheels,
    lightbar,
    x,
    z,
    heading,
    speed: 0,
    steerVis: 0,
    health: CAR.maxHealth,
    driver: 'parked', // parked | traffic | police | player
    dead: false,
  };
}

export function carForward(car) {
  return { x: Math.sin(car.heading), z: Math.cos(car.heading) };
}

export function damageCar(car, amount) {
  if (car.dead) return;
  car.health -= amount;
  if (car.health <= 0) {
    car.health = 0;
    car.dead = true;
  }
}

// One physics step. control: { throttle: -1..1, steer: -1..1, handbrake: bool }
// Returns the impact speed if the car hit something solid this step, else 0.
export function stepCar(car, control, dt) {
  if (dt <= 0) return 0;
  const spec = car.spec;
  const topSpeed = car.dead ? 4 : spec.topSpeed;
  if (control.throttle > 0) {
    car.speed += control.throttle * spec.accel * dt * (car.speed < 0 ? 2.2 : 1);
  } else if (control.throttle < 0) {
    if (car.speed > 0.5) car.speed += control.throttle * CAR.brake * dt;
    else car.speed = Math.max(car.speed + control.throttle * CAR.reverseAccel * dt, -9);
  }
  car.speed -= car.speed * CAR.drag * dt;
  if (!control.throttle) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 1.6 * dt);
  car.speed = clamp(car.speed, -9, topSpeed);
  if (control.handbrake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 6 * dt);

  const steerAuthority = clamp(car.speed / 7, -1, 1);
  const grip = control.handbrake ? CAR.handbrakeGrip : CAR.grip;
  car.heading -= control.steer * CAR.steerMax * grip * 0.16 * steerAuthority * dt * 4;
  car.steerVis = control.steer;

  const before = { x: car.x, z: car.z };
  const fwd = carForward(car);
  car.x += fwd.x * car.speed * dt;
  car.z += fwd.z * car.speed * dt;
  const pos = { x: car.x, z: car.z };
  collideCircle(pos, 1.55);
  let impact = 0;
  const moved = Math.hypot(pos.x - before.x, pos.z - before.z);
  const wanted = Math.abs(car.speed) * dt;
  if (wanted - moved > 0.35 && Math.abs(car.speed) > 4) {
    impact = Math.abs(car.speed);
    damageCar(car, impact * 0.55);
    car.speed = -car.speed * 0.22;
    pos.x = before.x;
    pos.z = before.z;
  }
  car.x = pos.x;
  car.z = pos.z;

  car.group.position.set(car.x, car.dead ? -0.06 : 0, car.z);
  car.group.rotation.y = car.heading;
  car.group.rotation.z = clamp(-control.steer * Math.abs(car.speed) * 0.0016, -0.05, 0.05);
  const spin = car.speed * dt * 2.6;
  car.wheels.forEach((wheel, i) => {
    wheel.rotation.x += spin;
    if (i < 2) wheel.rotation.y = -control.steer * 0.42;
  });
  return impact;
}

// Flash every interceptor lightbar, alternating red and blue.
export function flashLightbars(cars, elapsed) {
  const phase = Math.floor(elapsed * 2.4) % 2 === 0;
  for (const car of cars) {
    if (!car.lightbar) continue;
    const { red, blue } = car.lightbar.userData;
    red.material.emissiveIntensity = phase ? 2.2 : 0.15;
    blue.material.emissiveIntensity = phase ? 0.15 : 2.2;
  }
}
