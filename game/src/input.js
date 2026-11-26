// The pilot's hands: keyboard, mouse and touch all feed the same small set of
// continuous axes and a few discrete actions, so the flight model never has to
// know where a command came from.
export const AXIS = {
  PITCH: 'pitch',
  ROLL: 'roll',
  YAW: 'yaw',
  THROTTLE: 'throttle',
};

export const ACTION = {
  BRAKE: 1,
  FLAPS: 2,
  VIEW: 4,
  PAUSE: 8,
  RESTART: 16,
  START: 32,
};

/** The keys the flight model reads, and what each one does. */
const KEY_MAP = {
  KeyW: { axis: AXIS.PITCH, value: -1 },
  ArrowUp: { axis: AXIS.PITCH, value: -1 },
  KeyS: { axis: AXIS.PITCH, value: 1 },
  ArrowDown: { axis: AXIS.PITCH, value: 1 },
  KeyA: { axis: AXIS.ROLL, value: -1 },
  ArrowLeft: { axis: AXIS.ROLL, value: -1 },
  KeyD: { axis: AXIS.ROLL, value: 1 },
  ArrowRight: { axis: AXIS.ROLL, value: 1 },
  KeyQ: { axis: AXIS.YAW, value: -1 },
  KeyE: { axis: AXIS.YAW, value: 1 },
  KeyZ: { axis: AXIS.THROTTLE, value: -1 },
  KeyX: { axis: AXIS.THROTTLE, value: 1 },
  ShiftLeft: { action: ACTION.BRAKE },
  ShiftRight: { action: ACTION.BRAKE },
  KeyF: { action: ACTION.FLAPS },
  KeyC: { action: ACTION.VIEW },
  KeyP: { action: ACTION.PAUSE },
  Escape: { action: ACTION.PAUSE },
  KeyR: { action: ACTION.RESTART },
  Enter: { action: ACTION.START },
  Space: { action: ACTION.START },
};

export function createInput(canvas) {
  const keys = new Set();
  /** The keys pressed since the menu last looked: each is taken once. */
  const keysDown = new Set();
  const actions = { pending: 0 };
  const axes = {
    [AXIS.PITCH]: 0,
    [AXIS.ROLL]: 0,
    [AXIS.YAW]: 0,
    [AXIS.THROTTLE]: 0,
  };
  /** The throttle the pilot set, kept between frames: a lever, not a key. */
  let throttle = 0.0;
  /** The mouse's stick position, in -1..1 on each side. */
  const stick = { x: 0, y: 0, active: false };
  /** The on-screen controls' state, when the game is played with touch. */
  const touch = { active: false, pitch: 0, roll: 0, throttle: 0 };
  /** True while the on-screen brake button is held down. */
  let brakeHeld = false;

  function onKeyDown(event) {
    const binding = KEY_MAP[event.code];
    if (!binding) {
      // The menus read the arrow keys and Enter directly.
      if (!event.repeat) keysDown.add(event.code);
      return;
    }
    if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    if (!keys.has(event.code)) {
      if (binding.action) actions.pending |= binding.action;
      keys.add(event.code);
      keysDown.add(event.code);
    }
  }

  function onKeyUp(event) {
    keys.delete(event.code);
    keysDown.delete(event.code);
  }

  function onBlur() {
    keys.clear();
  }

  function onPointerMove(event) {
    if (event.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    stick.x = Math.max(-1, Math.min(1, (x - 0.5) * 2.2));
    stick.y = Math.max(-1, Math.min(1, (y - 0.5) * 2.2));
    stick.active = true;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', () => {
    stick.x = 0;
    stick.y = 0;
    stick.active = false;
  });

  /**
   * The axes as they are now. The keyboard and the mouse are blended: whichever
   * is moved further from the centre wins, so a pilot can use either or both.
   */
  function readAxes() {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    let throttleDelta = 0;
    for (const code of keys) {
      const binding = KEY_MAP[code];
      if (!binding) continue;
      if (binding.axis === AXIS.PITCH) pitch = binding.value;
      else if (binding.axis === AXIS.ROLL) roll = binding.value;
      else if (binding.axis === AXIS.YAW) yaw = binding.value;
      else if (binding.axis === AXIS.THROTTLE) throttleDelta += binding.value;
    }
    if (Math.abs(stick.y) > Math.abs(pitch)) pitch = stick.y;
    if (Math.abs(stick.x) > Math.abs(roll)) roll = stick.x;
    if (touch.active) {
      if (Math.abs(touch.pitch) > Math.abs(pitch)) pitch = touch.pitch;
      if (Math.abs(touch.roll) > Math.abs(roll)) roll = touch.roll;
      throttleDelta += touch.throttle;
    }
    axes[AXIS.PITCH] = pitch;
    axes[AXIS.ROLL] = roll;
    axes[AXIS.YAW] = yaw;
    return { axes, throttleDelta };
  }

  return {
    /** The keys pressed since the last look, for the menus. */
    keysDown,
    /** Forgets the keys the menus have read, so a held key acts only once. */
    clearKeysDown() {
      keysDown.clear();
    },
    /** The continuous axes, read fresh each frame. */
    axes,
    /** The throttle lever, 0..1. */
    get throttle() {
      return throttle;
    },
    set throttle(value) {
      throttle = Math.max(0, Math.min(1, value));
    },
    /** True while the brake key is held. */
    get braking() {
      return keys.has('ShiftLeft') || keys.has('ShiftRight') || brakeHeld;
    },
    /** The on-screen brake button sets this. */
    setBrake(value) {
      brakeHeld = value;
    },
    /** The actions pressed since the last call; each is taken once. */
    takeActions() {
      const pending = actions.pending;
      actions.pending = 0;
      return pending;
    },
    /** The axes and any throttle change since the last frame. */
    poll() {
      const result = readAxes();
      if (result.throttleDelta !== 0) {
        throttle = Math.max(0, Math.min(1, throttle + result.throttleDelta * 0.02));
      }
      return result.axes;
    },
    /** The on-screen controls set their own values, for a touch screen. */
    setTouch(pitch, roll, throttleChange) {
      touch.active = true;
      touch.pitch = pitch;
      touch.roll = roll;
      touch.throttle = throttleChange;
    },
    /** True when the player is touching the screen. */
    get isTouch() {
      return touch.active;
    },
    /** A fresh input set, for a new game. */
    reset() {
      keys.clear();
      keysDown.clear();
      actions.pending = 0;
      stick.x = 0;
      stick.y = 0;
      stick.active = false;
      touch.active = false;
      touch.pitch = 0;
      touch.roll = 0;
      touch.throttle = 0;
      throttle = 0;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
