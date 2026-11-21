// Keyboard and mouse state. Modules read the live state each frame instead of
// handling events, which keeps the controls identical in play and in tests.

const held = new Set();
const pressed = new Set(); // keys that went down since the last frame swap
let mouseDX = 0;
let mouseDY = 0;

export const input = {
  // Call once from the game loop after all systems have read the state.
  endFrame() {
    pressed.clear();
    mouseDX = 0;
    mouseDY = 0;
  },
  down: (code) => held.has(code),
  justPressed: (code) => pressed.has(code),
  mouseDelta: () => ({ x: mouseDX, y: mouseDY }),
  // Movement axes from the usual WASD + arrow layout.
  moveAxes() {
    const x = (held.has('KeyD') || held.has('ArrowRight') ? 1 : 0) - (held.has('KeyA') || held.has('ArrowLeft') ? 1 : 0);
    const z = (held.has('KeyS') || held.has('ArrowDown') ? 1 : 0) - (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0);
    return { x, z };
  },
  sprint: () => held.has('ShiftLeft') || held.has('ShiftRight'),
  handbrake: () => held.has('Space'),
};

// Synthetic key events, used by the headless play-test and screenshot scenes
// to drive the game exactly as a player's keyboard would.
export function pressKey(code, isDown) {
  if (isDown) {
    if (!held.has(code)) pressed.add(code);
    held.add(code);
  } else {
    held.delete(code);
  }
}

export function attachInput(target) {
  target.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    pressKey(event.code, true);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  });
  target.addEventListener('keyup', (event) => pressKey(event.code, false));
  target.addEventListener('blur', () => {
    held.clear();
    pressed.clear();
  });
  target.addEventListener('mousemove', (event) => {
    mouseDX += event.movementX ?? 0;
    mouseDY += event.movementY ?? 0;
  });
}
