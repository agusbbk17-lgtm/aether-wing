// The flight model: lift, drag, thrust, weight and the moments the pilot's
// controls make, integrated at a fixed step. It is a small, honest model of a
// single-engine aeroplane: it stalls, it drops a wing at low speed, it needs
// rudder in a turn and it will fly into the ground if the pilot lets it.
import * as THREE from '../vendor/three.module.min.js';
import { AIRCRAFT, PHYSICS } from './config.js';
import { heightAt } from './terrain.js';

/** The world's up, the sea's level. */
const UP = new THREE.Vector3(0, 1, 0);

/** How far the aeroplane's nose is above the horizon, in radians, clamped. */
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function createFlightModel() {
  const state = {
    /** The aeroplane's position, in metres. */
    position: new THREE.Vector3(0, heightAt(0, 0) + 2, 0),
    /** Its velocity, in metres per second. */
    velocity: new THREE.Vector3(0, 0, 0),
    /** The angle of attack, in radians: how far above the airflow the nose sits. */
    angleOfAttack: 0,
    /** The angle of the nose above the horizon, in radians. */
    pitch: 0,
    /** The roll: positive rolls the right wing down. */
    roll: 0,
    /** The heading, in radians, measured clockwise from north. */
    heading: 0,
    /** The rates the aeroplane is turning at, in radians per second. */
    pitchRate: 0,
    rollRate: 0,
    yawRate: 0,
    /** The throttle, 0..1. */
    throttle: 0,
    /** The fuel left, in litres. */
    fuel: AIRCRAFT.fuelCapacity,
    /** The flaps: 0 up, 1 fully down. */
    flaps: 0,
    /** True when the aeroplane is on its wheels. */
    onGround: true,
    /** True when the wing has stalled. */
    stalled: false,
    /** The damage taken so far, 0..1. */
    damage: 0,
    /** How hard the last impact was, for the camera and the sound. */
    impact: 0,
    /** The stall warning, 0..1, for the horn and the HUD. */
    stallWarning: 0,
    /** The g-force at the last step. */
    gForce: 1,
    /** The ground's height under the aeroplane. */
    groundHeight: 0,
    /** True once the aeroplane has left the ground under its own power. */
    airborne: false,
  };

  const state3 = {
    forward: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0),
    right: new THREE.Vector3(1, 0, 0),
    velocityDirection: new THREE.Vector3(0, 0, -1),
  };

  /** The world the model asks about the ground under it. */
  let world = null;

  function setWorld(nextWorld) {
    world = nextWorld;
  }

  /** A fresh flight, sitting on the runway's threshold. */
  function reset() {
    const start = world ? world.startPosition : new THREE.Vector3(0, 10, 500);
    state.position.copy(start);
    state.velocity.set(0, 0, 0);
    state.angleOfAttack = 0;
    state.pitch = 0;
    state.roll = 0;
    state.heading = 0;
    state.pitchRate = 0;
    state.rollRate = 0;
    state.yawRate = 0;
    state.throttle = 0;
    state.fuel = AIRCRAFT.fuelCapacity;
    state.flaps = 0;
    state.onGround = true;
    state.stalled = false;
    state.damage = 0;
    state.impact = 0;
    state.stallWarning = 0;
    state.airborne = false;
    state3.forward.set(0, 0, -1);
    state3.up.set(0, 1, 0);
    state3.right.set(1, 0, 0);
  }

  /** The world-space direction the aeroplane's nose points. */
  function forwardVector(out = new THREE.Vector3()) {
    const pitch = state.pitch;
    const heading = state.heading;
    const cosPitch = Math.cos(pitch);
    return out.set(Math.sin(heading) * cosPitch, Math.sin(pitch), -Math.cos(heading) * cosPitch).normalize();
  }

  /** The world-space direction of the aeroplane's right wing. */
  function rightVector(out = new THREE.Vector3()) {
    const heading = state.heading;
    return out.set(Math.cos(heading), 0, Math.sin(heading)).normalize();
  }

  /** The world-space direction of the aeroplane's spine. */
  function upVector(out = new THREE.Vector3()) {
    forwardVector(state3.forward);
    rightVector(state3.right);
    return out.crossVectors(state3.right, state3.forward).normalize();
  }

  /**
   * Advances the model by one step.
   * @param {number} dt the step, in seconds
   * @param {object} axes the pilot's axes: pitch, roll, yaw, throttle
   * @param {boolean} braking true while the wheel brakes are on
   */
  function step(dt, axes, braking) {
    const ground = heightAt(state.position.x, state.position.z);
    state.groundHeight = ground;
    const heightAboveGround = state.position.y - ground;
    const speed = state.velocity.length();
    const airspeed = speed;

    forwardVector(state3.forward);
    rightVector(state3.right);
    state3.up.crossVectors(state3.right, state3.forward).normalize();

    // --- The airflow's direction, and the angle of attack it sees.
    if (speed > 0.6) {
      state3.velocityDirection.copy(state.velocity).divideScalar(speed);
      const along = state3.velocityDirection.dot(state3.forward);
      const up = state3.velocityDirection.dot(state3.up);
      state.angleOfAttack = Math.atan2(-up, Math.max(0.05, along));
    } else {
      state3.velocityDirection.copy(state3.forward);
      state.angleOfAttack = 0;
    }

    // --- Thrust and fuel.
    const throttle = clamp(state.throttle, 0, 1);
    const hasFuel = state.fuel > 0;
    const thrust = hasFuel ? throttle * AIRCRAFT.thrust : 0;
    if (hasFuel) state.fuel = Math.max(0, state.fuel - throttle * AIRCRAFT.fuelBurn * dt);

    // --- The lift the wing makes at this angle of attack.
    const dynamicPressure = 0.5 * PHYSICS.airDensity * airspeed * airspeed;
    const flapLift = state.flaps * 0.22;
    const stallAngle = AIRCRAFT.stallAlpha * (1 + flapLift * 0.5);
    const alpha = state.angleOfAttack;
    const stallAlpha = state.flaps > 0.5 ? stallAngle * 1.12 : stallAngle;
    const liftCoefficient = AIRCRAFT.liftSlope * alpha * (1 + flapLift);
    const clampedCoefficient = clamp(liftCoefficient, -1.2, 1.45);
    const stalled = airspeed > 2 && Math.abs(alpha) > stallAlpha;
    state.stalled = stalled;
    const lift = dynamicPressure * AIRCRAFT.wingArea * clampedCoefficient * (stalled ? 0.55 : 1);

    // --- The drag: the parasite drag, plus the induced drag of the lift.
    const dragCoefficient = AIRCRAFT.dragBase + AIRCRAFT.dragInduced * clampedCoefficient * clampedCoefficient;
    const drag = dynamicPressure * AIRCRAFT.wingArea * dragCoefficient;

    // --- The forces, in world space.
    const force = new THREE.Vector3();
    force.addScaledVector(state3.up, lift);
    force.addScaledVector(state3.velocityDirection, -drag);
    force.addScaledVector(state3.forward, thrust);
    force.y -= AIRCRAFT.mass * PHYSICS.gravity;

    // --- The moments: the pilot's controls, plus the damping that settles the aeroplane.
    const authority = Math.min(1, airspeed / 26);
    const pitchInput = axes.pitch * AIRCRAFT.pitchPower * authority;
    const rollInput = axes.roll * AIRCRAFT.rollPower * authority;
    const yawInput = axes.yaw * AIRCRAFT.yawPower * authority;

    // The elevator also depends on how far the wing is from the airflow: a stalled
    // wing stops answering the stick.
    const controlEffectiveness = stalled ? 0.35 : 1;
    state.pitchRate += (pitchInput * controlEffectiveness - state.pitchRate) * AIRCRAFT.damping * dt;
    state.rollRate += (rollInput * controlEffectiveness - state.rollRate) * AIRCRAFT.damping * dt;
    state.yawRate += (yawInput * controlEffectiveness - state.yawRate) * AIRCRAFT.damping * dt;

    // A turn needs rudder: the fin pulls the nose round, and the slip is felt.
    const turnRate = state.rollRate;
    const adverseYaw = -turnRate * airspeed * 0.012;

    // The speed the wings are making: the faster it flies, the more it turns.
    const speedFactor = clamp(airspeed / 40, 0.25, 2.2);
    state.pitch += state.pitchRate * dt * speedFactor;
    state.roll += state.rollRate * dt * speedFactor;
    state.heading += (state.yawRate + adverseYaw) * dt * speedFactor * 0.55;

    // Gravity pulls the nose down when it is slow: the aeroplane wants to fall.
    const sink = (AIRCRAFT.mass * PHYSICS.gravity) / (AIRCRAFT.mass * Math.max(airspeed, 12));
    state.pitch -= (lift / Math.max(1, AIRCRAFT.mass * airspeed * 0.9) - sink * 0.02) * dt;

    state.pitch = clamp(state.pitch, -1.35, 1.35);
    state.roll = clamp(state.roll, -Math.PI, Math.PI);
    if (state.heading > Math.PI) state.heading -= Math.PI * 2;
    if (state.heading < -Math.PI) state.heading += Math.PI * 2;

    // --- The ground: the wheels carry the aeroplane when it is down.
    const wheelHeight = 1.15;
    if (heightAboveGround <= wheelHeight) {
      const wasAirborne = state.airborne;
      state.onGround = true;
      state.position.y = ground + wheelHeight;

      // Kill the downward motion, and take the speed's energy away.
      if (state.velocity.y < 0) {
        state.impact = Math.min(1, -state.velocity.y / 14);
        state.velocity.y = 0;
      }
      const friction = AIRCRAFT.groundFriction * (braking ? AIRCRAFT.wheelBrake : 1);
      state.velocity.multiplyScalar(Math.max(0, 1 - friction * dt));

      // Keep the aeroplane on the ground: the nose follows the ground's slope.
      const ahead = heightAt(state.position.x + state3.forward.x * 12, state.position.z + state3.forward.z * 12);
      const slope = Math.atan2(ahead - ground, 12);
      state.pitch += (slope - state.pitch) * Math.min(1, dt * 4);
      state.roll += (0 - state.roll) * Math.min(1, dt * 3);
      state.pitchRate = 0;
      state.rollRate = 0;

      // A taildragger needs its tail down: too much speed with the stick back
      // pitches the aeroplane over onto its nose.
      if (wasAirborne && airspeed > 24 && axes.pitch > 0.7 && state.roll > 1.1) {
        state.impact = Math.max(state.impact, 0.5);
        state.damage = Math.min(1, state.damage + 0.12);
      }
      state.airborne = false;
      state.stallWarning = 0;
    } else {
      state.onGround = false;
      state.airborne = true;
      state.impact = Math.max(0, state.impact - dt * 2);
    }

    // --- Integrate the velocity and the position.
    const acceleration = force.divideScalar(AIRCRAFT.mass);
    state.velocity.addScaledVector(acceleration, dt);
    state.position.addScaledVector(state.velocity, dt);

    // The stall warning rises as the wing approaches its critical angle.
    const margin = stallAlpha - Math.abs(alpha);
    state.stallWarning = airspeed > 2
      ? clamp(1 - margin / (stallAlpha * 0.65), 0, 1)
      : 0;

    // The g-force the pilot feels.
    state.gForce = lift / (AIRCRAFT.mass * PHYSICS.gravity);

    // A hard landing or a strike damages the aeroplane.
    if (state.impact > 0.35) {
      state.damage = Math.min(1, state.damage + state.impact * 0.25);
    }

    // Never let the aeroplane fall through the sea.
    if (state.position.y < 0.4) {
      state.position.y = 0.4;
      state.velocity.y = Math.max(0, state.velocity.y);
      state.damage = Math.min(1, state.damage + 0.08);
    }

    return state;
  }

  return {
    state,
    setWorld,
    reset,
    step,
    forwardVector,
    rightVector,
    upVector,
    /** The aeroplane's speed in knots, for the HUD. */
    get knots() {
      return state.velocity.length() * 1.94384;
    },
    /** The altitude above the sea, in metres. */
    get altitude() {
      return state.position.y;
    },
    /** The height above the ground, in metres. */
    get heightAboveGround() {
      return state.position.y - state.groundHeight;
    },
  };
}
