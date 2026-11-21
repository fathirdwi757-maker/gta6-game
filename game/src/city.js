// Procedural Solano City: a street grid of avenues and cross streets, city
// blocks filled by district, a beach and ocean on the east side, a working
// port in the south-west, and street props. Built once from a fixed seed so
// the layout is the same on every visit. Exports the building colliders and
// road tests every other system uses.

import * as THREE from 'three';
import { WORLD, COLORS } from './config.js';
import { worldRng as rng, clamp } from './random.js';

export const colliders = []; // { minX, maxX, minZ, maxZ } solid boxes
const propColliders = []; // thin props (palms, lamps): { x, z, r }

let waterMat = null;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// A facade: painted wall colour with a grid of windows, most of them lit
// warm for the late-afternoon look. A handful of variants are shared by all
// buildings so the whole city costs a few textures, not hundreds.
function facadeMaterial(base, trim) {
  const tex = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = trim;
    g.fillRect(0, 0, w, 8);
    g.fillRect(0, h - 10, w, 10);
    const cols = 6;
    const rows = 12;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const lit = rng.next() < 0.55;
        g.fillStyle = lit ? '#ffd98c' : '#2c3e50';
        g.fillRect(8 + x * 20, 16 + y * 19, 12, 11);
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return new THREE.MeshLambertMaterial({ map: tex });
}

const FACADES = [
  facadeMaterial('#e8e3d8', '#b8563f'),
  facadeMaterial('#f2d5c4', '#7fb3b0'),
  facadeMaterial('#dce9ec', '#c96f4a'),
  facadeMaterial('#efe6ef', '#5d8aa8'),
  facadeMaterial('#f7ead1', '#d98e4a'),
  facadeMaterial('#dfe8da', '#8a6fa8'),
  facadeMaterial('#f4d8d8', '#4a7d8c'),
  facadeMaterial('#e6ddcb', '#a8542f'),
];
const ROOF_MAT = new THREE.MeshLambertMaterial({ color: 0x6b5a4e });
const WAREHOUSE_MAT = new THREE.MeshLambertMaterial({ color: 0x8d99a6 });
const WAREHOUSE_MAT2 = new THREE.MeshLambertMaterial({ color: 0xa88f6d });

function addBox(group, mat, x, y, z, w, h, d, collide = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  if (collide) colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  return mesh;
}

function districtOf(cx, cz) {
  if (cx < -180 && cz > 140) return 'port';
  if (cx > 200) return 'beach';
  if (Math.abs(cx) < 160 && Math.abs(cz) < 160) return 'downtown';
  if (cx < -160 && cz < -160) return 'heights';
  return 'midtown';
}

function buildBlock(group, cx, cz, size) {
  const district = districtOf(cx, cz);
  if (district === 'port') {
    // Warehouses and container stacks, with room to drive between them.
    addBox(group, rng.pick([WAREHOUSE_MAT, WAREHOUSE_MAT2]), cx, 5, cz, size * 0.8, 10, size * 0.55);
    const boxCols = [0xc0392b, 0x2471a3, 0x229954, 0xca6f1e, 0x7d3c98];
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: rng.pick(boxCols) });
      addBox(group, mat, cx + rng.range(-size / 3, size / 3), 1.3, cz + size * 0.38, 6, 2.6, 2.4);
    }
    return;
  }
  const count = district === 'downtown' ? rng.int(2, 3) : rng.int(1, 3);
  for (let i = 0; i < count; i++) {
    const w = rng.range(size * 0.3, size * 0.52);
    const d = rng.range(size * 0.3, size * 0.52);
    const x = cx + rng.range(-size / 4, size / 4);
    const z = cz + rng.range(-size / 4, size / 4);
    let h;
    if (district === 'downtown') h = rng.range(26, 58);
    else if (district === 'beach') h = rng.range(14, 30);
    else if (district === 'heights') h = rng.range(7, 14);
    else h = rng.range(9, 24);
    const mat = rng.pick(FACADES);
    const mesh = addBox(group, mat, x, h / 2, z, w, h, d);
    mesh.material = mat;
    // A slightly larger flat cap reads as a roofline from the street.
    addBox(group, ROOF_MAT, x, h + 0.4, z, w + 1.2, 0.8, d + 1.2, false);
  }
}

// Palms and lamps are instanced: hundreds of props cost four draw calls.
// The palm crown is one horizontal plane with fronds drawn radiating from
// the centre — the classic low-poly palm, readable from street level.
const palmSpots = [];
const lampSpots = [];

const palmCrownTex = () =>
  canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#2e7d32';
    g.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      g.lineWidth = 9;
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.quadraticCurveTo(
        w / 2 + Math.cos(a) * w * 0.28,
        h / 2 + Math.sin(a) * h * 0.28,
        w / 2 + Math.cos(a) * w * 0.48,
        h / 2 + Math.sin(a) * h * 0.48,
      );
      g.stroke();
      g.lineWidth = 4;
      g.strokeStyle = '#43a047';
      g.stroke();
      g.strokeStyle = '#2e7d32';
    }
  });

function buildPalm(group, x, z) {
  palmSpots.push({ x, z, lean: rng.range(-0.09, 0.09), spin: rng.range(0, Math.PI * 2) });
  propColliders.push({ x, z, r: 0.35 });
}

function buildLamp(group, x, z) {
  lampSpots.push({ x, z });
  propColliders.push({ x, z, r: 0.22 });
}

function buildPropInstances(group) {
  const dummy = new THREE.Object3D();
  const trunks = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.16, 0.26, 5.6, 6),
    new THREE.MeshLambertMaterial({ color: 0x8a6f4d }),
    palmSpots.length,
  );
  const crowns = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(5.4, 5.4),
    new THREE.MeshLambertMaterial({ map: palmCrownTex(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }),
    palmSpots.length,
  );
  palmSpots.forEach((p, i) => {
    dummy.position.set(p.x, 2.8, p.z);
    dummy.rotation.set(0, 0, p.lean);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x + p.lean * 5.2, 5.85, p.z);
    dummy.rotation.set(-Math.PI / 2, 0, p.spin);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  trunks.castShadow = true;
  group.add(trunks, crowns);

  const poles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x37474f }),
    lampSpots.length,
  );
  const heads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.32, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffca28, emissiveIntensity: 0.9 }),
    lampSpots.length,
  );
  lampSpots.forEach((p, i) => {
    dummy.position.set(p.x, 2.7, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 5.5, p.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  group.add(poles, heads);
}

function buildSign(group, x, z, text, color) {
  const tex = canvasTexture(512, 96, (g, w, h) => {
    g.fillStyle = '#17323e';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 5;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = color;
    g.font = 'bold 52px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.6, 6), new THREE.MeshLambertMaterial({ color: 0x455a64 }));
  pole.position.set(x, 2.3, z);
  group.add(pole);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  board.position.set(x, 4.6, z);
  board.rotation.y = Math.PI / 4;
  group.add(board);
}

function buildCrane(group, x, z) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xd35400 });
  addBox(group, mat, x, 11, z, 1.6, 22, 1.6, false);
  addBox(group, mat, x, 11, z + 12, 1.6, 22, 1.6, false);
  const jib = addBox(group, mat, x, 22.5, z + 6, 1.2, 1.2, 30, false);
  jib.castShadow = false;
  colliders.push({ minX: x - 1.4, maxX: x + 1.4, minZ: z - 1.4, maxZ: z + 13.4 });
}

export function isOnRoad(x, z) {
  const half = WORLD.roadWidth / 2 + 0.5;
  for (const a of WORLD.avenues) if (Math.abs(x - a) < half) return true;
  for (const s of WORLD.streets) if (Math.abs(z - s) < half) return true;
  return false;
}

export function collideCircle(pos, radius) {
  // Push a circle (player or car centre) out of every building box and prop.
  for (const b of colliders) {
    const nx = clamp(pos.x, b.minX, b.maxX);
    const nz = clamp(pos.z, b.minZ, b.maxZ);
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > radius * radius) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else {
      // Centre inside the box: leave by the shallowest face.
      const left = pos.x - b.minX;
      const right = b.maxX - pos.x;
      const top = pos.z - b.minZ;
      const bottom = b.maxZ - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) pos.x = b.minX - radius;
      else if (m === right) pos.x = b.maxX + radius;
      else if (m === top) pos.z = b.minZ - radius;
      else pos.z = b.maxZ + radius;
    }
  }
  for (const p of propColliders) {
    const dx = pos.x - p.x;
    const dz = pos.z - p.z;
    const rr = radius + p.r;
    const d2 = dx * dx + dz * dz;
    if (d2 < rr * rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      pos.x = p.x + (dx / d) * rr;
      pos.z = p.z + (dz / d) * rr;
    }
  }
  pos.x = clamp(pos.x, -WORLD.half + 1, WORLD.half - 1);
  pos.z = clamp(pos.z, -WORLD.half + 1, WORLD.half - 1);
}

export function buildCity(scene) {
  const group = new THREE.Group();
  const H = WORLD.half;

  // Base ground: city concrete with a green tint away from the centre.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(H * 2 + 160, H * 2 + 160),
    new THREE.MeshLambertMaterial({ color: 0x8f9a83 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground);

  // Roads: sidewalk slab then asphalt, for every avenue and street.
  const walkMat = new THREE.MeshLambertMaterial({ color: COLORS.sidewalk });
  const roadMat = new THREE.MeshLambertMaterial({ color: COLORS.asphalt });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5d76e });
  const slab = (mat, w, d, x, z, y) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  for (const a of WORLD.avenues) {
    slab(walkMat, WORLD.roadWidth + 5, H * 2, a, 0, 0.0);
    slab(roadMat, WORLD.roadWidth, H * 2, a, 0, 0.02);
    slab(lineMat, 0.35, H * 2, a, 0, 0.035);
  }
  for (const s of WORLD.streets) {
    slab(walkMat, H * 2, WORLD.roadWidth + 5, 0, s, 0.005);
    slab(roadMat, H * 2, WORLD.roadWidth, 0, s, 0.025);
    slab(lineMat, H * 2, 0.35, 0, s, 0.04);
  }

  // Beach and sea on the east edge.
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(H - WORLD.beachX + 60, H * 2 + 160), new THREE.MeshLambertMaterial({ color: COLORS.sand }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((WORLD.beachX + H + 60) / 2 - 15, 0.01, 0);
  sand.receiveShadow = true;
  group.add(sand);
  const waterTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#1e7f86';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 3;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(0, 14 + i * 26);
      g.bezierCurveTo(w * 0.3, 6 + i * 26, w * 0.7, 22 + i * 26, w, 14 + i * 26);
      g.stroke();
    }
  });
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.repeat.set(10, 40);
  // No mipmaps on the sea: it is one huge, heavily minified plane, and
  // mip-chain sampling is the single most expensive thing a software
  // rasterizer does. The animated offset hides the shimmer.
  waterTex.generateMipmaps = false;
  waterTex.minFilter = THREE.LinearFilter;
  waterMat = new THREE.MeshLambertMaterial({ map: waterTex, transparent: true, opacity: 0.94 });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(360, H * 2 + 320), waterMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(WORLD.beachX + 195, 0.12, 0);
  group.add(sea);

  // Blocks: the ground between two avenues and two streets.
  const edges = [-H, ...WORLD.avenues, H];
  const zEdges = [-H, ...WORLD.streets, H];
  for (let i = 0; i < edges.length - 1; i++) {
    for (let j = 0; j < zEdges.length - 1; j++) {
      const cx = (edges[i] + edges[i + 1]) / 2;
      const cz = (zEdges[j] + zEdges[j + 1]) / 2;
      const size = Math.min(edges[i + 1] - edges[i], zEdges[j + 1] - zEdges[j]) - WORLD.roadWidth - 6;
      if (size < 20) continue;
      if (cx > WORLD.beachX - 30) continue; // beach blocks stay sand
      buildBlock(group, cx, cz, size);
    }
  }

  // Palms along the beach avenue and lamps on every corner.
  for (let z = -H + 20; z < H; z += 26) {
    buildPalm(group, WORLD.avenues[7] + 10.5, z + rng.range(-3, 3));
    buildPalm(group, WORLD.avenues[7] - 10.5, z + 13 + rng.range(-3, 3));
  }
  for (const a of WORLD.avenues) {
    for (const s of WORLD.streets) {
      buildLamp(group, a + WORLD.roadWidth / 2 + 1.6, s + WORLD.roadWidth / 2 + 1.6);
      buildLamp(group, a - WORLD.roadWidth / 2 - 1.6, s - WORLD.roadWidth / 2 - 1.6);
    }
  }

  buildPropInstances(group);

  // Port cranes on the waterfront blocks.
  buildCrane(group, -268, 268);
  buildCrane(group, -188, 292);

  // District signs.
  buildSign(group, 24, -52, 'DOWNTOWN', '#ffd54f');
  buildSign(group, 232, 30, 'CORAL BEACH', '#ff8a80');
  buildSign(group, -236, 196, 'PORT SOLANO', '#80cbc4');
  buildSign(group, -236, -196, 'PALM HEIGHTS', '#c5e1a5');
  buildSign(group, -96, 116, 'MIDTOWN', '#b39ddb');

  scene.add(group);
  return group;
}

export function updateCity(dt, elapsed) {
  if (waterMat) waterMat.map.offset.y = (elapsed * 0.014) % 1;
}
