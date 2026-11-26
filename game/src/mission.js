// The mission: a course of rings to fly through, a clock to beat, and a landing
// at the end that is scored on how well the aeroplane is put down. Three mission
// types give the sortie a goal: a time trial, a cargo run, and a rescue.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';
import { createRandom } from './random.js';
import { heightAt } from './terrain.js';

/** The kinds of mission, and what each one is worth. */
export const MISSION_TYPES = {
  timeTrial: {
    id: 'timeTrial',
    name: 'Time Trial',
    brief: 'Fly the ring course against the clock.',
    rings: 9,
    timeLimit: 150,
    fuelCost: 1,
  },
  cargoRun: {
    id: 'cargoRun',
    name: 'Cargo Run',
    brief: 'Collect every pod, then bring it home.',
    rings: 8,
    timeLimit: 210,
    fuelCost: 1.35,
  },
  rescue: {
    id: 'rescue',
    name: 'Search and Rescue',
    brief: 'Find the flare over the ridge and land.',
    rings: 7,
    timeLimit: 240,
    fuelCost: 1.2,
  },
};

/**
 * A ring: a glowing hoop the aeroplane must fly through, with a direction it
 * should be going and a radius that closes as the pilot lines up on it.
 */
function createRing(position, direction, radius, colour) {
  const geometry = new THREE.TorusGeometry(radius, radius * 0.055, 10, 40);
  const material = new THREE.MeshBasicMaterial({
    color: colour,
    transparent: true,
    opacity: 0.92,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.lookAt(position.clone().add(direction));
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 1.12, radius * 0.02, 6, 32),
    new THREE.MeshBasicMaterial({
      color: colour, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  glow.position.copy(position);
  glow.lookAt(position.clone().add(direction));
  mesh.add(glow);
  return { mesh, glow, position, direction, radius, passed: false, colour };
}

/**
 * The whole mission: the course, the clock, the fuel used and the score.
 */
export function createMission(type, seed = 4242) {
  const random = createRandom(seed);
  const definition = MISSION_TYPES[type] ?? MISSION_TYPES.timeTrial;
  const group = new THREE.Group();
  const rings = [];

  // The course: a spiral of rings over the island, each one higher and further
  // out, so the pilot has to climb, turn and speed-run between them.
  const ringColours = [0x63e6ff, 0xffd166, 0x9dff9a, 0xff8fa3, 0xc39bff];
  for (let index = 0; index < definition.rings; index += 1) {
    const angle = index * 1.25 + random() * 0.4;
    const radiusFromCentre = 700 + index * 260 + random() * 220;
    const x = Math.cos(angle) * radiusFromCentre;
    const z = Math.sin(angle) * radiusFromCentre;
    const ground = heightAt(x, z);
    const y = Math.max(ground + 130, 120 + index * 62 + random() * 60);
    const direction = new THREE.Vector3(
      Math.cos(angle + 1.4),
      -0.05 + random() * 0.1,
      Math.sin(angle + 1.4),
    ).normalize();
    const ring = createRing(
      new THREE.Vector3(x, y, z),
      direction,
      34 + random() * 8,
      ringColours[index % ringColours.length],
    );
    rings.push(ring);
    group.add(ring.mesh);
  }

  const state = {
    type: definition.id,
    name: definition.name,
    brief: definition.brief,
    /** The clock, in seconds, counting down. */
    timeLeft: definition.timeLimit,
    /** The ring the pilot must fly through next. */
    index: 0,
    /** How many rings the pilot has flown through. */
    ringsPassed: 0,
    ringsTotal: rings.length,
    /** The time the last ring was flown through, for the split times. */
    splits: [],
    /** True once the course is finished and the pilot must land. */
    courseComplete: false,
    /** The score the pilot has earned so far. */
    score: 0,
    /** The fuel the mission will use: a longer course burns more. */
    fuelCost: definition.fuelCost,
    /** How close the aeroplane is to the next ring, 0..1, for the HUD's guidance. */
    guidance: 0,
    /** The direction to the next ring, relative to the aeroplane's nose. */
    bearing: 0,
    /** The distance to the next ring, in metres. */
    distance: 0,
    /** The landing's score, filled in when the aeroplane touches down. */
    landing: null,
    /** True when the mission has ended, one way or the other. */
    finished: false,
    /** Why the mission ended. */
    outcome: null,
  };

  return {
    group,
    state,
    rings,
    definition,
    /** A fresh run of the same course. */
    reset() {
      state.timeLeft = definition.timeLimit;
      state.index = 0;
      state.ringsPassed = 0;
      state.splits = [];
      state.courseComplete = false;
      state.score = 0;
      state.landing = null;
      state.finished = false;
      state.outcome = null;
      rings.forEach((ring) => {
        ring.passed = false;
        ring.mesh.visible = true;
        ring.mesh.material.opacity = 0.92;
      });
    },
    /**
     * Advances the mission by one step.
     * @param {number} dt the step, in seconds
     * @param {object} flight the flight model's state
     */
    step(dt, flight) {
      if (state.finished) return state;
      if (!state.courseComplete) {
        state.timeLeft -= dt;
        if (state.timeLeft <= 0) {
          state.timeLeft = 0;
          state.finished = true;
          state.outcome = 'timeout';
        }
      }

      const ring = rings[state.index];
      if (ring) {
        const offset = flight.position.clone().sub(ring.position);
        state.distance = offset.length();
        // The guidance line: the ring turns brighter as the pilot lines up on it.
        const alignment = 1 - Math.min(1, offset.length() / 900);
        state.guidance = alignment;
        const toRing = ring.position.clone().sub(flight.position).normalize();
        const forward = new THREE.Vector3(
          Math.sin(flight.heading) * Math.cos(flight.pitch),
          Math.sin(flight.pitch),
          -Math.cos(flight.heading) * Math.cos(flight.pitch),
        );
        state.bearing = Math.atan2(
          toRing.x * forward.z - toRing.z * forward.x,
          toRing.x * forward.x + toRing.z * forward.z,
        );

        // The ring is passed when the aeroplane is inside the hoop: `radial` is
        // the distance from the ring's axis, and `along` the distance from its
        // plane. Both have to be small, so the aeroplane really goes through
        // the ring rather than past it.
        const along = offset.dot(ring.direction);
        const radial = offset.clone().addScaledVector(ring.direction, -along).length();
        if (radial < ring.radius * 0.96 && Math.abs(along) < ring.radius * 1.2) {
          state.ringsPassed += 1;
          state.splits.push(state.timeLeft);
          state.score += Math.round(500 + state.timeLeft * 4);
          ring.passed = true;
          ring.mesh.material.color.setHex(0x9dff9a);
          state.index += 1;
          if (state.index >= rings.length) {
            state.courseComplete = true;
            state.score += 2500;
          }
        }
      }

      // The rings behind the pilot fade away, so the course reads clearly.
      rings.forEach((each, index) => {
        if (index < state.index && !state.finished) {
          each.mesh.material.opacity = Math.max(0.15, each.mesh.material.opacity - dt * 0.5);
        }
      });
      return state;
    },
    /**
     * Scores a landing: how close to the runway's centre line, how slowly the
     * aeroplane touched down, and how flat it was.
     */
    scoreLanding(flight, runway) {
      const lateral = Math.abs(flight.position.x - runway.x);
      const along = Math.abs(flight.position.z - runway.z);
      const vertical = flight.velocity.y;
      const horizontal = Math.hypot(flight.velocity.x, flight.velocity.z);
      const onCentre = Math.max(0, 1 - lateral / 22);
      const onTheStrip = Math.max(0, 1 - along / (runway.length * 0.5));
      const soft = Math.max(0, 1 - Math.abs(vertical) / 6);
      const straight = Math.max(0, 1 - Math.abs(flight.roll) / 0.5);
      const slow = Math.max(0, 1 - Math.max(0, horizontal - 26) / 40);
      const total = Math.round(
        1200 * onCentre + 900 * onTheStrip + 1100 * soft + 500 * straight + 700 * slow,
      );
      state.landing = {
        score: total,
        lateral,
        along,
        vertical,
        horizontal,
        onCentre,
        onTheStrip,
        soft,
        straight,
        slow,
      };
      state.score += total;
      state.finished = true;
      state.outcome = 'landed';
      return state.landing;
    },
    /** Ends the mission as a failure. */
    fail(reason) {
      state.finished = true;
      state.outcome = reason;
    },
    /** The next ring's position, or null when the course is done. */
    nextRing() {
      return rings[state.index] ?? null;
    },
  };
}
