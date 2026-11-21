// The HUD: cash, wanted stars, health, the objective line, interaction
// prompts, toasts, and a canvas minimap. Plain DOM updated only when a value
// actually changes, plus the minimap redrawn each frame.

import { WORLD } from './config.js';
import { clamp } from './random.js';

const el = {};
let lastValues = {};
let toastTimer = null;

export const hudActions = {
  onNewGame: () => {},
  onContinue: () => {},
  onResume: () => {},
  onRestart: () => {},
  onRespawn: () => {},
};

export function initHud() {
  for (const id of ['cash', 'stars', 'health-fill', 'objective', 'prompt', 'toast', 'minimap', 'speedo', 'bust-wrap', 'bust-fill', 'title-screen', 'pause-screen', 'end-screen', 'end-title', 'end-text', 'briefing', 'briefing-title', 'briefing-text', 'btn-continue']) {
    el[id] = document.getElementById(id);
  }
  document.getElementById('btn-new').addEventListener('click', () => hudActions.onNewGame());
  el['btn-continue'].addEventListener('click', () => hudActions.onContinue());
  document.getElementById('btn-resume').addEventListener('click', () => hudActions.onResume());
  document.getElementById('btn-restart').addEventListener('click', () => hudActions.onRestart());
  document.getElementById('btn-respawn').addEventListener('click', () => hudActions.onRespawn());
}

function setText(id, value) {
  if (lastValues[id] !== value) {
    lastValues[id] = value;
    el[id].textContent = value;
  }
}

export function showScreen(name, hasSave = false) {
  el['title-screen'].style.display = name === 'title' ? 'flex' : 'none';
  el['pause-screen'].style.display = name === 'pause' ? 'flex' : 'none';
  el['end-screen'].style.display = name === 'end' ? 'flex' : 'none';
  if (name === 'title') el['btn-continue'].style.display = hasSave ? 'block' : 'none';
}

export function setEndScreen(kind, text) {
  el['end-title'].textContent = kind;
  el['end-title'].style.color = kind === 'BUSTED' ? '#64b5f6' : '#ef5350';
  el['end-text'].textContent = text;
}

export function showBriefing(title, text) {
  el['briefing-title'].textContent = title;
  el['briefing-text'].textContent = text;
  el['briefing'].style.display = 'block';
}

export function hideBriefing() {
  el['briefing'].style.display = 'none';
}

export function toast(message, ms = 3400) {
  el['toast'].textContent = message;
  el['toast'].style.opacity = '1';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el['toast'].style.opacity = '0';
  }, ms);
}

export function updateHud(state) {
  setText('cash', `$${Math.max(0, Math.floor(state.cash)).toLocaleString('en-US')}`);
  const stars = '★'.repeat(state.stars) + '☆'.repeat(5 - state.stars);
  if (lastValues.stars !== stars) {
    lastValues.stars = stars;
    el['stars'].textContent = stars;
    el['stars'].style.opacity = state.stars > 0 ? '1' : '0.25';
  }
  const healthPct = `${clamp(state.health, 0, 100)}%`;
  if (lastValues.health !== healthPct) {
    lastValues.health = healthPct;
    el['health-fill'].style.width = healthPct;
    el['health-fill'].style.background = state.health > 30 ? '#66bb6a' : '#ef5350';
  }
  setText('objective', state.objective ?? '');
  if (lastValues.prompt !== state.prompt) {
    lastValues.prompt = state.prompt;
    el['prompt'].textContent = state.prompt ?? '';
    el['prompt'].style.opacity = state.prompt ? '1' : '0';
  }
  setText('speedo', state.speedKmh != null ? `${Math.round(state.speedKmh)} km/h` : '');
  const bust = state.bust ?? 0;
  el['bust-wrap'].style.display = bust > 0.02 ? 'block' : 'none';
  if (bust > 0.02) el['bust-fill'].style.width = `${Math.round(bust * 100)}%`;
}

// Minimap: a north-up square of the city around the player. Roads, the
// beach, then blips — the player as a white arrow, cars as dots, police
// flashing, and the objective marker as a pulsing ring.
export function drawMinimap(view) {
  const canvas = el['minimap'];
  if (!canvas) return;
  const g = canvas.getContext('2d');
  const S = canvas.width;
  const range = 190; // metres shown across the map
  const scale = S / range;
  const { playerPos, heading, cars, cops, marker, elapsed } = view;
  const toMap = (x, z) => ({
    x: S / 2 + (x - playerPos.x) * scale,
    y: S / 2 + (z - playerPos.z) * scale,
  });

  g.fillStyle = '#22414d';
  g.fillRect(0, 0, S, S);
  // Beach + sea to the east.
  const beach = toMap(WORLD.beachX, 0);
  g.fillStyle = '#c9ae7e';
  g.fillRect(beach.x, 0, S - beach.x, S);
  g.fillStyle = '#1e7f86';
  g.fillRect(beach.x + 16 * scale, 0, S, S);
  // Roads.
  g.strokeStyle = '#4d646e';
  g.lineWidth = Math.max(2, WORLD.roadWidth * scale);
  for (const a of WORLD.avenues) {
    const p = toMap(a, 0);
    g.beginPath();
    g.moveTo(p.x, 0);
    g.lineTo(p.x, S);
    g.stroke();
  }
  for (const s of WORLD.streets) {
    const p = toMap(0, s);
    g.beginPath();
    g.moveTo(0, p.y);
    g.lineTo(S, p.y);
    g.stroke();
  }
  // Cars.
  for (const car of cars) {
    const p = toMap(car.x, car.z);
    if (p.x < -4 || p.y < -4 || p.x > S + 4 || p.y > S + 4) continue;
    g.fillStyle = '#b0bec5';
    g.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  // Police, flashing.
  const flash = Math.floor(elapsed * 2.4) % 2 === 0;
  for (const car of cops) {
    const p = toMap(car.x, car.z);
    if (p.x < -4 || p.y < -4 || p.x > S + 4 || p.y > S + 4) continue;
    g.fillStyle = flash ? '#ff5252' : '#448aff';
    g.beginPath();
    g.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
    g.fill();
  }
  // Objective marker.
  if (marker) {
    const p = toMap(marker.x, marker.z);
    const cx = clamp(p.x, 8, S - 8);
    const cy = clamp(p.y, 8, S - 8);
    const r = 5 + Math.sin(elapsed * 3.2) * 1.6;
    g.strokeStyle = `#${marker.color.toString(16).padStart(6, '0')}`;
    g.lineWidth = 2.4;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
  }
  // Player arrow. The arrow is drawn pointing up; on the map the player's
  // forward (sin h, cos h) in world x/z lands as (sin h, cos h) in screen
  // x/y-down, so the arrow must rotate by PI - heading to point along it.
  g.save();
  g.translate(S / 2, S / 2);
  g.rotate(Math.PI - heading);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(0, -7);
  g.lineTo(4.6, 5);
  g.lineTo(0, 2.4);
  g.lineTo(-4.6, 5);
  g.closePath();
  g.fill();
  g.restore();
}
