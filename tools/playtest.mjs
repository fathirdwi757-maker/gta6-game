// Headless play-test for Solano Heat: starts a new game with real keyboard
// events, walks, drives the hero car, and accepts the first mission.
// Run from the repository root:  node tools/playtest.mjs
// Exits non-zero on any failed assertion or console error.
//
// All waits are condition-based with generous wall-clock budgets: under
// software rendering the frame rate is low and the game clock (dt clamped)
// runs slower than wall-clock, so fixed sleeps would be flaky.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(process.env.HOME, 'workspace/tools/screenshot/package.json'));
const { chromium } = require('playwright');
const PORT = 8150;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: repo, stdio: 'pipe' });
let failed = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failed++;
};

try {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/index.html`);
      if (res.ok) break;
    } catch { /* wait */ }
    await wait(250);
  }
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  const state = () => page.evaluate(() => {
    const s = window.__solano;
    return {
      mode: s.mode(),
      x: s.player.x, z: s.player.z,
      inCar: s.player.car !== null,
      speed: s.player.car ? Math.abs(s.player.car.speed) : 0,
      objective: s.objective(),
    };
  });
  // Poll until fn(state) holds or the wall-clock budget runs out.
  async function until(fn, budgetMs, label) {
    const t0 = Date.now();
    let st = await state();
    while (!fn(st)) {
      if (Date.now() - t0 > budgetMs) {
        console.log(`  … timeout waiting for ${label}; state=${JSON.stringify(st)}`);
        return st;
      }
      await wait(400);
      st = await state();
    }
    return st;
  }

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__solano && window.__solano.ready, null, { timeout: 60000 });
  check('game boots to the title screen', (await state()).mode === 'title');

  await page.click('#btn-new');
  const started = await until((s) => s.mode === 'playing', 20000, 'playing mode');
  check('NEW GAME starts play', started.mode === 'playing');

  const before = await state();
  await page.keyboard.down('w');
  const walkedTo = await until(
    (s) => Math.hypot(s.x - before.x, s.z - before.z) > 3, 90000, 'walking 3 m');
  await page.keyboard.up('w');
  const walked = Math.hypot(walkedTo.x - before.x, walkedTo.z - before.z);
  check(`player walks with W (moved ${walked.toFixed(1)} m)`, walked > 3);

  // Stand beside the hero Comet and get in.
  await page.evaluate(() => {
    const p = window.__solano.player;
    p.x = 255.5;
    p.z = 74;
  });
  await page.keyboard.press('f');
  const entered = await until((s) => s.inCar, 20000, 'entering car');
  check('F enters the parked car', entered.inCar);

  await page.keyboard.down('w');
  const driven = await until((s) => s.speed > 6, 120000, 'car reaching speed');
  await page.keyboard.up('w');
  check(`car drives (reached ${driven.speed.toFixed(1)} m/s)`, driven.speed > 6);

  await page.keyboard.press('f');
  const exited = await until((s) => !s.inCar, 20000, 'exiting car');
  check('F exits the car', !exited.inCar);

  // Walk to Marisol and take the first job.
  await page.evaluate(() => {
    const p = window.__solano.player;
    p.x = 247.5;
    p.z = 45.5;
  });
  await page.keyboard.press('e');
  let briefingOpen = false;
  for (let i = 0; i < 40 && !briefingOpen; i++) {
    briefingOpen = await page.evaluate(() => document.getElementById('briefing').style.display === 'block');
    if (!briefingOpen) await wait(400);
  }
  check('E opens the mission briefing', briefingOpen);
  await page.keyboard.press('e');
  const accepted = await until((s) => s.objective.includes('Beach Run'), 20000, 'mission objective');
  check(`E accepts the mission (objective: "${accepted.objective}")`, accepted.objective.includes('Beach Run'));

  check(`no console errors (${errors.length})`, errors.length === 0);
  if (errors.length) console.error(errors.slice(0, 5));
  await browser.close();
} finally {
  server.kill();
}
if (failed) {
  console.error(`play-test failed: ${failed} check(s)`);
  process.exit(1);
}
console.log('play-test passed end to end');
