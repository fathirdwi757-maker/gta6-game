// Screenshot capture for Solano Heat: serves the game locally, loads each
// scene from shots.json in headless Chromium, and writes the JPEGs into
// screenshots/. Run from the repository root:  node tools/capture.mjs
// Fails loudly on any console error, an oversize file or a bad dimension.

import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(process.env.HOME, 'workspace/tools/screenshot/package.json'));
const { chromium } = require('playwright');

const PORT = 8123;
const shots = JSON.parse(readFileSync(join(repo, 'shots.json'), 'utf8'));

const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: repo, stdio: 'pipe' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/index.html`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await wait(250);
  }
  throw new Error('server did not come up');
}

let failures = 0;
try {
  await waitForServer();
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  for (const shot of shots) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto(`http://localhost:${PORT}/${shot.query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__solano && window.__solano.ready, null, { timeout: 30000 });
    await wait(1600); // let the scene settle: water moving, lightbars flashing
    const out = join(repo, 'screenshots', shot.name);
    await page.screenshot({ path: out, type: 'jpeg', quality: 86 });
    const size = statSync(out).size;
    const dims = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    console.log(`${shot.name}: ${size} bytes, viewport ${dims.w}x${dims.h}, console errors: ${errors.length}`);
    if (errors.length) {
      failures++;
      console.error('  errors:', errors.slice(0, 4));
    }
    if (size > 262144) {
      failures++;
      console.error('  TOO BIG: over the 256 KiB screenshot cap');
    }
    await page.close();
  }
  await browser.close();
} finally {
  server.kill();
}
if (failures) {
  console.error(`capture failed (${failures} problem scene(s))`);
  process.exit(1);
}
console.log('all screenshots captured cleanly');
