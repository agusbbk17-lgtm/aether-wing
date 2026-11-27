// The still pictures the entry's screenshots are taken from. Each scene is
// staged with the game's own rules: the aeroplane is flown by a small
// autopilot, the camera is the game's own camera, and the instruments are the
// game's own instruments. Nothing is drawn or composited by hand, so every
// screenshot is a real frame of the game, flown to the frame that is kept.
//
// The mode is entered with ?shot=<name>. The scene is staged in a burst of
// simulation steps, drawn once, and the two canvases are read back into one
// picture, which the page leaves on window.__shotDataUrl.
import * as THREE from '../vendor/three.module.min.js';
import { PHYSICS } from './config.js';
import { heightAt } from './terrain.js';

/** The step the autopilot flies the aeroplane with. */
const STEP = PHYSICS.step;

/** Keeps a number inside the range a control law may use. */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * A small autopilot, and the reason it exists is that the flight model has no
 * self-levelling: left to itself the aeroplane keeps whatever bank it had. The
 * controller therefore aims at a waypoint AND holds an attitude, damping each
 * rate so the aeroplane arrives at the angle instead of swinging past it.
 * @param {object} api the game's own objects
 * @param {object} wish the waypoint to aim for, the bank the wings may use, and
 *   the pitch the nose is trimmed at.
 */
function createAutopilot(api, wish = {}) {
  const axes = { pitch: 0, roll: 0, yaw: 0 };
  const bank = wish.bank ?? 0.24;
  const trim = wish.trim ?? 0.02;
  return {
    axes,
    /** The controls the autopilot wants for this step. */
    steer() {
      const flight = api.flight.state;
      const target = wish.target ?? api.mission.nextRing()?.position ?? api.world.runwayTarget();
      const toTarget = target.clone().sub(flight.position);
      const distance = Math.max(60, toTarget.length());
      toTarget.normalize();
      // Where the waypoint lies as seen from the nose: ahead, and to the right.
      const lateral = toTarget.x * Math.cos(flight.heading) + toTarget.z * Math.sin(flight.heading);
      const ahead = toTarget.x * Math.sin(flight.heading) - toTarget.z * Math.cos(flight.heading);
      // The bank the turn needs, then the aileron that reaches it.
      const wanted = clamp(Math.atan2(lateral, Math.max(0.03, ahead)) * 0.8, -bank, bank);
      axes.roll = clamp((wanted - flight.roll) * 2.6 - flight.rollRate * 0.6, -1, 1);
      // The nose: the trimmed pitch, nudged by how far above it the waypoint is.
      const climb = clamp((toTarget.y / distance) * 1.7, -0.09, 0.09);
      axes.pitch = clamp((trim + climb - flight.pitch) * 2.4 - flight.pitchRate * 0.5, -1, 1);
      // A little rudder into the turn, so the ball is not left on the outside.
      axes.yaw = clamp(flight.roll * 0.5, -0.35, 0.35);
      return axes;
    },
  };
}

/** Runs the flight model forward by `seconds`, flying it with the autopilot. */
function flyFor(api, autopilot, seconds) {
  const steps = Math.round(seconds / STEP);
  for (let index = 0; index < steps; index += 1) {
    const axes = autopilot.steer();
    api.flight.step(STEP, axes, false);
    api.mission.step(STEP, api.flight.state);
    api.trails.update(api.flight);
    if (api.mission.state.finished) break;
  }
}

/**
 * Holds the throttle where the picture wants it. The lever is the one the
 * pilot's keys move, so the instrument and the engine both read it as they
 * really would, and the flight model is thrust-limited by the same number.
 */
function holdThrottle(api, value) {
  api.setThrottle(value);
  api.flight.state.throttle = value;
}

/**
 * Places the aeroplane at a point in the sky, pointing along a heading, and
 * gives it the speed it would have there.
 */
function place(api, position, heading, speed, pitch = 0) {
  const flight = api.flight.state;
  flight.position.copy(position);
  flight.heading = heading;
  flight.pitch = pitch;
  flight.roll = 0;
  flight.rollRate = 0;
  flight.pitchRate = 0;
  flight.yawRate = 0;
  flight.onGround = false;
  flight.airborne = true;
  flight.groundHeight = heightAt(position.x, position.z);
  flight.velocity.set(
    Math.sin(heading) * Math.cos(pitch) * speed,
    Math.sin(pitch) * speed,
    -Math.cos(heading) * Math.cos(pitch) * speed,
  );
  api.rig.snap(api.flight);
}

/**
 * Reads a ring of the course the mission is holding, whatever the pilot's index
 * is, by borrowing the index for a moment.
 */
function ringAt(api, index) {
  const state = api.mission.state;
  const saved = state.index;
  state.index = clamp(index, 0, state.ringsTotal - 1);
  const ring = api.mission.nextRing();
  state.index = saved;
  return ring;
}

/**
 * The line the course flies into ring `index`: a point `behind` metres short of
 * it, on the straight between it and the ring before, with the heading and the
 * pitch that line needs. Staging on the course's own line means the aeroplane
 * is really on its way to the ring when the shutter opens, and the ring sits in
 * the middle of the picture.
 */
function onLeg(api, index, behind, offset = 0) {
  const to = ringAt(api, index).position;
  const from = index > 0 ? ringAt(api, index - 1).position : api.world.runwayTarget();
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const run = Math.hypot(dx, dz) || 1;
  const heading = Math.atan2(dx, -dz);
  const pitch = Math.atan2(dy, run);
  const position = new THREE.Vector3(
    to.x - (dx / run) * behind + Math.cos(heading) * offset,
    to.y - (dy / run) * behind,
    to.z - (dz / run) * behind + Math.sin(heading) * offset,
  );
  api.mission.state.index = index;
  api.mission.state.ringsPassed = index;
  return { position, heading, pitch };
}

/**
 * Draws the scene and the instruments, then reads them back as one JPEG.
 */
function capture(api) {
  const gl = api.renderer.getContext();
  const info = { lostBefore: gl.isContextLost() };
  // The instruments are smoothed while flying, so a still frame would otherwise
  // show the needles still travelling towards the values the aeroplane holds.
  // Snap them to the truth first: the photograph then reads the real flight.
  window.__mark = 'snapped';
  api.hud.snap(api.flight);
  window.__mark = 'drawing';
  api.draw(1 / 60);
  window.__mark = 'drawn';
  info.lostAfter = gl.isContextLost();
  const scene = api.canvas;
  const hud = api.hudCanvas;
  const out = document.createElement('canvas');
  out.width = scene.width;
  out.height = scene.height;
  const context = out.getContext('2d');
  context.drawImage(scene, 0, 0);
  context.drawImage(hud, 0, 0, out.width, out.height);
  window.__mark = 'encoding';
  window.__shotDataUrl = out.toDataURL('image/jpeg', 0.86);
  window.__mark = 'encoded';
  window.__shotReady = true;
  window.__shotInfo = info;
  // What the picture actually shows, so the run can be checked afterwards.
  const flight = api.flight.state;
  window.__shotFlight = {
    roll: Number(flight.roll.toFixed(3)),
    pitch: Number(flight.pitch.toFixed(3)),
    heading: Number(flight.heading.toFixed(3)),
    throttle: Number(flight.throttle.toFixed(2)),
    knots: Number(api.flight.knots.toFixed(0)),
    altitude: Number(api.flight.altitude.toFixed(0)),
    aboveGround: Number(api.flight.heightAboveGround.toFixed(0)),
    rings: api.mission.state.ringsPassed,
    of: api.mission.state.ringsTotal,
  };
}

/**
 * Stages the named picture and takes it.
 * @param {string} name the picture: cover, cockpit, coastline, landing, results or title
 */
export function stageShot(name, api) {
  window.__mark = 'enter';
  const clean = name.replace(/^[0-9]+-/, '');
  let autopilot;
  let throttle = 0.85;
  let flown = 2.4;
  let cameraDistance = 17;

  const missionDone = () => {
    const state = api.mission.state;
    state.index = state.ringsTotal;
    state.ringsPassed = state.ringsTotal;
    state.courseComplete = true;
  };

  switch (clean) {
    case 'cockpit': {
      // The cockpit view on final approach through the high country ring,
      // looking past the nose at the lit horizon and course markers.
      api.startMission('timeTrial');
      api.beginFlight();
      const leg = onLeg(api, 7, 560);
      place(api, leg.position, leg.heading, 64, leg.pitch);
      autopilot = createAutopilot(api, { bank: 0.2, trim: leg.pitch });
      throttle = 0.82;
      api.rig.setView('cockpit');
      break;
    }
    case 'coastline': {
      // The west coast, quartered so the shore crosses the picture: the surf
      // line runs away to the left, the peaks hold the right, and the plane
      // keeps to the ridge it was staged on. The target lies along the coast
      // rather than out to sea, so the shoreline stays in frame as it flies.
      api.startMission('timeTrial');
      api.beginFlight();
      api.mission.state.index = 5;
      api.mission.state.ringsPassed = 5;
      const heading = 0.33;
      const position = new THREE.Vector3(-2292, 343, -2292);
      place(api, position, heading, 58, -0.015);
      const target = position.clone().add(new THREE.Vector3(
        Math.sin(heading) * 2400, -24, -Math.cos(heading) * 2400,
      ));
      autopilot = createAutopilot(api, { target, bank: 0.12, trim: -0.015 });
      throttle = 0.62;
      flown = 3.2;
      api.rig.setView('chase');
      break;
    }
    case 'landing': {
      // Chase view on leg through ring 6 across the island plateau,
      // showing the wings and landscape relief.
      api.startMission('timeTrial');
      api.beginFlight();
      const leg = onLeg(api, 6, 560);
      place(api, leg.position, leg.heading, 66, leg.pitch);
      autopilot = createAutopilot(api, { bank: 0.15, trim: leg.pitch });
      cameraDistance = 16;
      api.rig.setView('chase');
      break;
    }
    case 'results': {
      // The score screen, after a good landing.
      api.startMission('timeTrial');
      api.beginFlight();
      api.mission.state.ringsPassed = 9;
      api.mission.state.score = 12480;
      api.mission.state.splits = [142, 128, 116, 104, 96, 88, 79, 70, 62];
      api.mission.state.courseComplete = true;
      api.mission.state.timeLeft = 58;
      place(api, new THREE.Vector3(2, 30, 700), 0, 30, -0.04);
      api.flight.state.flaps = 1;
      autopilot = createAutopilot(api, { bank: 0.06, trim: -0.05 });
      throttle = 0.5;
      flown = 0.8;
      api.endMission('landed');
      break;
    }
    case 'title': {
      api.setScreen('title');
      break;
    }
    case 'cover':
    default: {
      // The cover: the last ring of the course, lined up over the island's high
      // country with the snow line below, the coast and the open sea ahead, and
      // the engine's trail still streaming from the ring behind.
      api.startMission('timeTrial');
      api.beginFlight();
      const leg = onLeg(api, 8, 560);
      place(api, leg.position, leg.heading, 66, leg.pitch);
      autopilot = createAutopilot(api, { bank: 0.2, trim: leg.pitch });
      // The cover wants the aeroplane large in the frame, so the eye is brought
      // in from the chase distance it settles at while flying.
      cameraDistance = 15;
      api.rig.setView('chase');
      break;
    }
  }

  // Fly the scene into shape, then hold the throttle and let the game's own
  // loop run a few frames so the camera, the trails and the instruments are
  // those of a flown frame rather than of a placed one.
  window.__mark = 'placed';
  holdThrottle(api, throttle);
  flyFor(api, autopilot, flown);
  window.__mark = 'flown';
  holdThrottle(api, throttle);
  // The autopilot's run moves the aeroplane a couple of hundred metres while
  // the camera is not stepped at all, so the rig would still be sitting where
  // the aeroplane started: the picture would then show it small and far off,
  // with its own trail crossing the whole frame. Place the eye on the flown
  // attitude first, then let the game's own loop settle it from there.
  api.rig.state.distance = cameraDistance;
  api.rig.state.view = api.rig.state.view;
  api.rig.snap(api.flight);
  window.__mark = 'settling';
  for (let index = 0; index < 30; index += 1) {
    api.simulate(1 / 60);
  }
  api.rig.snap(api.flight);
  capture(api);
}
