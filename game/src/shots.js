// The still pictures the entry's screenshots are taken from. Each scene is
// staged with the game's own rules: the aeroplane is flown by a small
// autopilot that steers towards the next ring, the camera is the game's own
// camera, and the instruments are the game's own instruments. Nothing is drawn
// or composited by hand, so every screenshot is a real frame of the game.
//
// The mode is entered with ?shot=<name>. The scene is staged in a burst of
// simulation steps, drawn once, and the two canvases are read back into one
// picture, which the page leaves on window.__shotDataUrl.
import * as THREE from '../vendor/three.module.min.js';
import { PHYSICS } from './config.js';
import { heightAt } from './terrain.js';

/** The step the autopilot flies the aeroplane with. */
const STEP = PHYSICS.step;

/**
 * A simple autopilot: it points the aeroplane at the next ring, keeps it
 * level and holds a height a little above the ring's.
 * @param {object} api the game's own objects
 */
function createAutopilot(api) {
  const axes = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
  return {
    axes,
    /** The controls the autopilot wants for this step. */
    steer() {
      const flight = api.flight.state;
      const ring = api.mission.nextRing();
      const target = ring ? ring.position : api.world.runwayTarget();
      const forward = new THREE.Vector3(
        Math.sin(flight.heading) * Math.cos(flight.pitch),
        Math.sin(flight.pitch),
        -Math.cos(flight.heading) * Math.cos(flight.pitch),
      );
      const toTarget = target.clone().sub(flight.position);
      const distance = toTarget.length();
      toTarget.normalize();
      // The error in the horizontal plane, as a roll command.
      const right = new THREE.Vector3(Math.cos(flight.heading), 0, Math.sin(flight.heading));
      const lateral = toTarget.dot(right);
      const ahead = toTarget.dot(forward);
      axes.roll = Math.max(-1, Math.min(1, lateral * 2.4));
      // The height error: climb when the target is above the nose.
      const climbError = toTarget.y - forward.y * 0.6;
      axes.pitch = Math.max(-1, Math.min(1, climbError * 2.2));
      if (ahead < 0 && distance > 400) axes.roll = Math.sign(lateral || 1);
      // Throttle: fast for the rings, slow when the landing is near.
      axes.throttle = distance > 600 ? 0.95 : 0.55;
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
 * Draws the scene and the instruments, then reads them back as one JPEG.
 */
function capture(api) {
  const gl = api.renderer.getContext();
  const info = { lostBefore: gl.isContextLost() };
  api.draw(1 / 60);
  info.lostAfter = gl.isContextLost();
  const scene = api.canvas;
  const hud = api.hudCanvas;
  const out = document.createElement('canvas');
  out.width = scene.width;
  out.height = scene.height;
  const context = out.getContext('2d');
  context.drawImage(scene, 0, 0);
  context.drawImage(hud, 0, 0, out.width, out.height);
  window.__shotDataUrl = out.toDataURL('image/jpeg', 0.86);
  window.__shotReady = true;
  window.__shotInfo = info;
}

/**
 * Stages the named picture and takes it.
 * @param {string} name the picture: cover, cockpit, coastline, landing, results or title
 */
export function stageShot(name, api) {
  const autopilot = createAutopilot(api);

  const clean = name.replace(/^[0-9]+-/, ""); switch (clean) {
    case 'cockpit': {
      // In the cockpit, banked over the coast with the ring ahead.
      api.startMission('timeTrial');
      api.beginFlight();
      place(api, new THREE.Vector3(-1850, 420, 1450), 2.35, 62, -0.05);
      api.rig.setView('cockpit');
      flyFor(api, autopilot, 0.4);
      break;
    }
    case 'coastline': {
      // Low over the water, the shoreline and the surf to one side.
      api.startMission('timeTrial');
      api.beginFlight();
      place(api, new THREE.Vector3(2950, 165, 2350), 3.95, 58, -0.04);
      api.rig.setView('chase');
      flyFor(api, autopilot, 0.4);
      break;
    }
    case 'landing': {
      // On final approach to Reach Field, low over the threshold.
      api.startMission('timeTrial');
      api.beginFlight();
      place(api, new THREE.Vector3(4, 46, 1150), 0, 44, -0.06);
      api.flight.state.flaps = 1;
      api.rig.setView('chase');
      flyFor(api, autopilot, 0.4);
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
      flyFor(api, autopilot, 0.5);
      api.endMission('landed');
      break;
    }
    case 'title': {
      api.setScreen('title');
      break;
    }
    case 'cover':
    default: {
      // The cover: the aeroplane in a chase view over the island, with the
      // next ring glowing ahead of it and the runway in the distance.
      api.startMission('timeTrial');
      api.beginFlight();
      place(api, new THREE.Vector3(-980, 360, 1680), 2.62, 66, -0.03);
      api.rig.setView('chase');
      flyFor(api, autopilot, 1.2);
      break;
    }
  }

  // A few more frames so the camera settles and the trails catch up.
  for (let index = 0; index < 30; index += 1) {
    api.simulate(1 / 60);
  }
  capture(api);
}
