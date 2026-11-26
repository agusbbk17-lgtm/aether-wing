// The page's entry point: it starts the game, wires the touch controls and
// lets the screenshot mode stage a scene for the camera.
import { boot } from './main.js';

const game = boot();

// --- The touch controls: a stick on the left, a throttle and buttons on the
// right, for a game played on a tablet.
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  document.body.classList.add('touch');
  const stick = document.getElementById('stick');
  const throttle = document.getElementById('throttle');
  const viewButton = document.getElementById('viewBtn');
  const brakeButton = document.getElementById('brakeBtn');

  let stickPointer = null;
  let stickOrigin = { x: 0, y: 0 };
  const stickState = { pitch: 0, roll: 0 };

  stick.addEventListener('pointerdown', (event) => {
    stickPointer = event.pointerId;
    const rect = stick.getBoundingClientRect();
    stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    stick.setPointerCapture(event.pointerId);
  });
  stick.addEventListener('pointermove', (event) => {
    if (event.pointerId !== stickPointer) return;
    const radius = stick.getBoundingClientRect().width / 2;
    stickState.roll = Math.max(-1, Math.min(1, (event.clientX - stickOrigin.x) / radius));
    stickState.pitch = Math.max(-1, Math.min(1, (event.clientY - stickOrigin.y) / radius));
    game.setTouch(stickState.pitch, stickState.roll, 0);
  });
  const releaseStick = () => {
    stickPointer = null;
    stickState.pitch = 0;
    stickState.roll = 0;
    game.setTouch(0, 0, 0);
  };
  stick.addEventListener('pointerup', releaseStick);
  stick.addEventListener('pointercancel', releaseStick);

  let throttlePointer = null;
  throttle.addEventListener('pointerdown', (event) => {
    throttlePointer = event.pointerId;
    throttle.setPointerCapture(event.pointerId);
  });
  throttle.addEventListener('pointermove', (event) => {
    if (event.pointerId !== throttlePointer) return;
    const rect = throttle.getBoundingClientRect();
    const at = 1 - (event.clientY - rect.top) / rect.height;
    game.setThrottle(Math.max(0, Math.min(1, at)));
  });
  throttle.addEventListener('pointerup', () => { throttlePointer = null; });

  viewButton.addEventListener('click', () => game.toggleView());
  brakeButton.addEventListener('click', () => game.setBrake(true));
}
