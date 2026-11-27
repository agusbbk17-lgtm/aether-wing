// The camera that follows the aeroplane. There are two views: a chase view that
// sits behind and above the tail and lags a little in a turn, and a cockpit view
// from the pilot's seat. The camera never fights the pilot: it smooths what it
// can and keeps the aeroplane's own attitude in the frame.
import * as THREE from '../vendor/three.module.min.js';
import { PHYSICS } from './config.js';

export const VIEW = {
  CHASE: 'chase',
  COCKPIT: 'cockpit',
};

export function createCameraRig(camera) {
  const state = {
    view: VIEW.CHASE,
    /** The smoothed position the camera is at. */
    position: new THREE.Vector3(0, 30, 60),
    /** The smoothed point the camera looks at. */
    lookAt: new THREE.Vector3(),
    /** The field of view, in degrees: it opens up with speed. */
    fov: 62,
    /** A shake, added when the aeroplane is hit. */
    shake: 0,
    /** How far the camera is behind the aeroplane. */
    distance: 17,
  };

  const desiredPosition = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();

  return {
    state,
    /** Switches between the chase and the cockpit view. */
    toggle() {
      state.view = state.view === VIEW.CHASE ? VIEW.COCKPIT : VIEW.CHASE;
      return state.view;
    },
    setView(view) {
      state.view = view;
    },
    /**
     * Places the camera for this frame.
     * @param {object} flight the flight model
     * @param {number} delta the frame's length, in seconds
     */
    update(flight, delta) {
      const position = flight.state.position;
      const speed = flight.state.velocity.length();

      forward.set(
        Math.sin(flight.state.heading) * Math.cos(flight.state.pitch),
        Math.sin(flight.state.pitch),
        -Math.cos(flight.state.heading) * Math.cos(flight.state.pitch),
      ).normalize();
      right.set(Math.cos(flight.state.heading), 0, Math.sin(flight.state.heading)).normalize();
      up.crossVectors(right, forward).normalize();

      if (state.view === VIEW.COCKPIT) {
        // The pilot's eye: in the seat, looking out over the nose.
        desiredPosition.copy(position)
          .addScaledVector(forward, 0.9)
          .addScaledVector(up, 0.62);
        desiredLook.copy(position).addScaledVector(forward, 60).addScaledVector(up, 1.4);
        state.position.lerp(desiredPosition, Math.min(1, delta * 26));
        state.lookAt.lerp(desiredLook, Math.min(1, delta * 18));
        state.fov = 68 + Math.min(10, speed * 0.09);
      } else {
        // The chase view: behind and above, and it swings out in a turn so the
        // aeroplane's roll is always readable.
        const pullBack = state.distance + Math.min(6, speed * 0.05);
        desiredPosition.copy(position)
          .addScaledVector(forward, -pullBack)
          .addScaledVector(up, 4.4 + Math.min(2, speed * 0.02));
        // A little to the side, in the direction the pilot is turning.
        desiredPosition.addScaledVector(right, flight.state.rollRate * 6);
        state.position.lerp(desiredPosition, Math.min(1, delta * PHYSICS.cameraLag));
        desiredLook.copy(position).addScaledVector(forward, 12).addScaledVector(up, 1.2);
        state.lookAt.lerp(desiredLook, Math.min(1, delta * 9));
        state.fov = 60 + Math.min(14, speed * 0.13);
      }

      // The shake: a hard landing or a strike shakes the camera.
      if (flight.state.impact > 0.2) state.shake = Math.max(state.shake, flight.state.impact);
      state.shake = Math.max(0, state.shake - delta * 2.2);

      camera.position.copy(state.position);
      if (state.shake > 0.01) {
        camera.position.x += (Math.random() - 0.5) * state.shake * 0.9;
        camera.position.y += (Math.random() - 0.5) * state.shake * 0.9;
      }
      camera.lookAt(state.lookAt);
      if (Math.abs(camera.fov - state.fov) > 0.05) {
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
      }
    },
    /** Places the camera at once, for the first frame and for a reset. */
    snap(flight) {
      const position = flight.state.position;
      forward.set(
        Math.sin(flight.state.heading) * Math.cos(flight.state.pitch),
        Math.sin(flight.state.pitch),
        -Math.cos(flight.state.heading) * Math.cos(flight.state.pitch),
      ).normalize();
      right.set(Math.cos(flight.state.heading), 0, Math.sin(flight.state.heading)).normalize();
      up.crossVectors(right, forward).normalize();
      if (state.view === VIEW.COCKPIT) {
        // The pilot's eye, placed at once so a held view does not swing in.
        state.position.copy(position).addScaledVector(forward, 0.9).addScaledVector(up, 0.62);
        state.lookAt.copy(position).addScaledVector(forward, 60).addScaledVector(up, 1.4);
        state.fov = 68 + Math.min(10, flight.state.velocity.length() * 0.09);
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
      } else {
        state.position.copy(position).addScaledVector(forward, -state.distance).addScaledVector(up, 4.6);
        state.lookAt.copy(position).addScaledVector(forward, 12).addScaledVector(up, 1.2);
        state.fov = 60 + Math.min(14, flight.state.velocity.length() * 0.13);
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
      }
      camera.position.copy(state.position);
      camera.lookAt(state.lookAt);
    },
  };
}
