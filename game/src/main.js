// Aether Wing: the boot, the loop and the screens. The game runs at a fixed
// physics step (several in a slow frame, none in a fast one), draws the 3D
// picture into one canvas and the instruments into another over it.
import * as THREE from '../vendor/three.module.min.js';
import { AIRCRAFT, GAME, HUD, PALETTE, PHYSICS, QUALITY, WORLD } from './config.js';
import { createAircraft } from './aircraft.js';
import { createAudio } from './audio.js';
import { createCameraRig, VIEW } from './camera.js';
import { createFlightModel } from './flight.js';
import { createHud } from './hud.js';
import { createInput, ACTION } from './input.js';
import { createMenus } from './menus.js';
import { createMission, MISSION_TYPES } from './mission.js';
import { createRandom } from './random.js';
import { stageShot } from './shots.js';
import { createAircraftTextures } from './textures.js';
import { createTrails } from './trails.js';
import { heightAt } from './terrain.js';
import { createSky } from './sky.js';
import { createWorld } from './world.js';

const SCREEN = {
  TITLE: 'title',
  BRIEF: 'brief',
  PLAY: 'play',
  PAUSED: 'paused',
  RESULTS: 'results',
};

/** The longest frame the loop catches up on; a longer stall is dropped, not replayed. */
const MAX_FRAME = 0.25;

export function boot() {
  const canvas = document.getElementById('scene');
  const hudCanvas = document.getElementById('hud');
  const status = document.getElementById('status');
  // The screenshot mode asks for a still picture, so the canvas keeps what was
  // drawn in it and can be read back.
  const shotMode = new URLSearchParams(window.location.search).has('shot');

  // --- The renderer: WebGL2, a device-pixel-ratio canvas, ACES tone mapping and
  // sRGB output, with soft shadows.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: shotMode,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 40000);
  camera.position.set(0, 40, 80);

  // --- The quality preset, chosen from what the machine can do.
  const quality = { ...QUALITY.high };
  const detected = detectQuality(renderer);
  Object.assign(quality, detected);

  // The still-picture mode can be asked for a lighter world, which keeps the
  // shot quick on a machine without a GPU.
  const requestedQuality = new URLSearchParams(window.location.search).get('quality');
  if (requestedQuality && QUALITY[requestedQuality]) {
    Object.assign(quality, QUALITY[requestedQuality]);
    detected.key = requestedQuality;
  }

  // --- The world, the sky and the aeroplane.
  const world = createWorld(quality, renderer);
  world.setFog(scene);
  scene.add(world.group);

  const sky = createSky(quality, world.sun);
  scene.add(sky.group);

  const aircraftTextures = createAircraftTextures(quality);
  const aircraft = createAircraft(aircraftTextures);
  scene.add(aircraft.group);

  const trails = createTrails(quality);
  scene.add(trails.group);

  const flight = createFlightModel();
  const rig = createCameraRig(camera);
  const hud = createHud(hudCanvas);
  const menus = createMenus();
  const audio = createAudio();
  const input = createInput(canvas);

  // --- The world the flight model asks about: where the aeroplane starts, and
  // where the runway is.
  const runway = { x: 0, z: 0, length: WORLD.runwayLength };
  const worldInfo = {
    startPosition: new THREE.Vector3(0, heightAt(0, 620) + 1.2, 620),
  };
  flight.setWorld(worldInfo);

  // --- The mission, its screens and the state the game keeps between them.
  let mission = createMission('timeTrial', 4242);
  world.mission = mission;
  scene.add(mission.group);

  const game = {
    screen: SCREEN.TITLE,
    selection: 0,
    missionType: 'timeTrial',
    quality: detected.key,
    muted: false,
    /** The best score of this visit, kept in the browser. */
    best: readBest(),
    /** The summary the results screen shows. */
    summary: { fuel: 0, damage: 0, landing: null },
    /** The frame counter, for the frame-rate readout. */
    fps: 60,
    fpsTimer: 0,
    frames: 0,
  };

  // The title screen shows the aeroplane on the apron, in a slow orbit.
  flight.reset();
  rig.snap(flight);

  function announce(message) {
    status.textContent = message;
  }

  function readBest() {
    try {
      return Number.parseInt(window.localStorage.getItem('aether-wing-best') ?? '0', 10) || 0;
    } catch {
      return 0;
    }
  }

  function saveBest(value) {
    try {
      window.localStorage.setItem('aether-wing-best', String(value));
    } catch {
      // Storage can be off: the best score then lasts this visit only.
    }
  }

  /** Starts a sortie of the given kind. */
  function startMission(type) {
    game.missionType = type;
    // The old course leaves the scene before the new one joins it.
    scene.remove(mission.group);
    mission = createMission(type, 4242);
    world.mission = mission;
    scene.add(mission.group);
    flight.reset();
    flight.state.throttle = 0.7;
    trails.reset();
    rig.snap(flight);
    game.screen = SCREEN.BRIEF;
    game.summary = { fuel: 0, damage: 0, landing: null };
    announce(`${MISSION_TYPES[type].name}. ${MISSION_TYPES[type].brief}`);
  }

  /** Starts the flight itself, from the brief. */
  function beginFlight() {
    game.screen = SCREEN.PLAY;
    audio.start();
    announce('Flying. Fly through the rings, then land at Reach Field.');
  }

  /** Goes back to the title. */
  function toTitle() {
    game.screen = SCREEN.TITLE;
    game.selection = 0;
    flight.reset();
    trails.reset();
    rig.snap(flight);
  }

  /** Ends the sortie and shows the score. */
  function endMission(reason) {
    if (mission.state.finished) return;
    if (reason === 'landed') {
      const landing = mission.scoreLanding(flight.state, runway);
      game.summary.landing = landing;
      audio.touchdown(0.4);
      if (landing.score > 2200) audio.fanfare();
    } else {
      mission.fail(reason);
      if (reason === 'crashed') audio.crash();
    }
    game.summary.fuel = flight.state.fuel;
    game.summary.damage = flight.state.damage;
    if (mission.state.score > game.best) {
      game.best = mission.state.score;
      saveBest(game.best);
    }
    game.screen = SCREEN.RESULTS;
    announce(`Sortie ended. Score ${mission.state.score}.`);
  }

  /** Checks the aeroplane against the ground and the runway. */
  function checkGround() {
    const height = flight.state.position.y - flight.state.groundHeight;
    if (height > 1.4) return;
    const onStrip = Math.abs(flight.state.position.x) < WORLD.runwayWidth * 0.75
      && Math.abs(flight.state.position.z) < WORLD.runwayLength * 0.5;
    if (onStrip && flight.state.onGround && mission.state.courseComplete && flight.state.velocity.length() < 32) {
      endMission('landed');
      return;
    }
    if (flight.state.impact > 0.22) {
      endMission('crashed');
    } else if (flight.state.onGround && !mission.state.courseComplete && flight.state.velocity.length() < 6) {
      // It came to a stop on the grass: the sortie is over.
      endMission('down');
    }
  }

  /** Handles the keys that are not the flight controls. */
  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION.VIEW) {
      rig.toggle();
      announce(rig.state.view === VIEW.COCKPIT ? 'Cockpit view.' : 'Chase view.');
    }
    if (actions & ACTION.FLAPS) {
      flight.state.flaps = flight.state.flaps > 0.5 ? 0 : 1;
      announce(flight.state.flaps > 0.5 ? 'Flaps down.' : 'Flaps up.');
    }
    if (actions & ACTION.PAUSE) {
      if (game.screen === SCREEN.PLAY) {
        game.screen = SCREEN.PAUSED;
        announce('Paused.');
      } else if (game.screen === SCREEN.PAUSED) {
        game.screen = SCREEN.PLAY;
        announce('Flying.');
      }
    }
    if (actions & ACTION.RESTART) {
      if (game.screen === SCREEN.PLAY || game.screen === SCREEN.PAUSED) startMission(game.missionType);
      else if (game.screen === SCREEN.RESULTS) startMission(game.missionType);
    }
    if (actions & ACTION.START) {
      if (game.screen === SCREEN.TITLE && game.selection === 0) startMission(game.missionType);
      else if (game.screen === SCREEN.BRIEF) beginFlight();
      else if (game.screen === SCREEN.RESULTS) startMission(game.missionType);
      else if (game.screen === SCREEN.PAUSED) game.screen = SCREEN.PLAY;
    }
  }

  /** The menus' own navigation: the arrow keys and the number keys. */
  function handleMenuKeys() {
    if (game.screen === SCREEN.TITLE) {
      const options = 6;
      if (input.keysDown.has('ArrowDown')) game.selection = (game.selection + 1) % options;
      if (input.keysDown.has('ArrowUp')) game.selection = (game.selection + options - 1) % options;
      if (input.keysDown.has('Enter') && game.selection > 0) {
        if (game.selection <= 3) startMission(['timeTrial', 'timeTrial', 'cargoRun', 'rescue'][game.selection]);
        else if (game.selection === 4) cycleQuality();
        else if (game.selection === 5) toggleSound();
      }
    }
  }

  function cycleQuality() {
    const order = ['low', 'high', 'ultra'];
    const index = order.indexOf(game.quality);
    const next = order[(index + 1) % order.length];
    game.quality = next;
    Object.assign(quality, QUALITY[next]);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[next].pixelRatio));
    renderer.shadowMap.enabled = QUALITY[next].shadows;
    world.sunLight.castShadow = QUALITY[next].shadows;
    announce(`Quality: ${QUALITY[next].label}.`);
  }

  function toggleSound() {
    game.muted = !game.muted;
    audio.setMuted(game.muted);
    announce(game.muted ? 'Sound off.' : 'Sound on.');
  }

  // --- The resize handler: the canvases and the camera follow the window.
  function resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const dpr = renderer.getPixelRatio();
    hudCanvas.width = Math.floor(width * dpr);
    hudCanvas.height = Math.floor(height * dpr);
    hudCanvas.style.width = `${width}px`;
    hudCanvas.style.height = `${height}px`;
  }
  window.addEventListener('resize', resize);
  resize();

  // --- The loop.
  let accumulator = 0;
  let last = performance.now();
  let elapsed = 0;

  /**
   * Advances the world by one frame: the pilot's input, the flight model, the
   * mission, the camera and the sounds. It draws nothing, so a still picture
   * can be staged with as many steps as it needs.
   */
  function simulate(delta) {
    elapsed += delta;

    const axes = input.poll();
    flight.state.throttle = input.throttle;
    handleActions();
    handleMenuKeys();

    if (game.screen === SCREEN.PLAY) {
      accumulator += delta;
      let steps = 0;
      while (accumulator >= PHYSICS.step && steps < 16) {
        flight.step(PHYSICS.step, axes, input.braking);
        mission.step(PHYSICS.step, flight.state);
        accumulator -= PHYSICS.step;
        steps += 1;
        if (mission.state.finished) break;
      }
      if (mission.state.finished) {
        if (mission.state.outcome !== 'timeout') endMission(mission.state.outcome);
      }
      checkGround();
      trails.update(flight);
      audio.update(flight.state, flight.state.throttle, flight.state.airborne);
      audio.stall(flight.state.stallWarning);
      if (flight.state.stallWarning > 0.5 && Math.random() < delta * 2) audio.timeWarning();
      if (mission.state.ringsPassed !== hud.lastRings) {
        hud.lastRings = mission.state.ringsPassed;
        audio.ringChime();
      }
    } else if (game.screen === SCREEN.TITLE) {
      // The title's slow orbit around the aeroplane on the apron.
      const angle = elapsed * 0.12;
      const radius = 34;
      camera.position.set(
        flight.state.position.x + Math.cos(angle) * radius,
        flight.state.position.y + 9,
        flight.state.position.z + Math.sin(angle) * radius,
      );
      camera.lookAt(flight.state.position);
      aircraft.update(flight, { pitch: 0, roll: 0, yaw: 0 }, delta, 0.15);
    }

    // The camera follows the aeroplane.
    if (game.screen !== SCREEN.TITLE) rig.update(flight, delta);
  }

  /** Draws the world and the instruments for the frame that was just simulated. */
  function draw(delta) {
    const axes = input.axes;

    // --- The aeroplane's own transform.
    if (game.screen !== SCREEN.TITLE) {
      aircraft.group.position.copy(flight.state.position);
      aircraft.group.rotation.set(0, 0, 0);
      aircraft.group.rotateY(flight.state.heading);
      aircraft.group.rotateX(flight.state.pitch);
      aircraft.group.rotateZ(-flight.state.roll);
      aircraft.update(flight, axes, delta, flight.state.throttle);
    }

    // --- The world follows the aeroplane, so the shadows stay sharp.
    world.followSun(flight.state.position);
    world.update(elapsed);
    sky.update(camera.position, elapsed);

    renderer.render(scene, camera);

    // --- The HUD, and the screens that sit over it.
    hudCanvas.width = hudCanvas.width;
    hud.draw(flight, mission.state, world, delta, game);

    const context = hudCanvas.getContext('2d');
    if (game.screen === SCREEN.TITLE) menus.drawTitle(context, hudCanvas, game.selection, game.quality);
    else if (game.screen === SCREEN.BRIEF) menus.drawBrief(context, hudCanvas, mission.state, MISSION_TYPES[game.missionType].name);
    else if (game.screen === SCREEN.PAUSED) menus.drawPause(context, hudCanvas, game.quality, game.muted);
    else if (game.screen === SCREEN.RESULTS) menus.drawResults(context, hudCanvas, mission.state, game.summary);

    // The frame-rate readout, once a second.
    game.frames += 1;
    game.fpsTimer += delta;
    if (game.fpsTimer > 1) {
      game.fps = Math.round(game.frames / game.fpsTimer);
      game.frames = 0;
      game.fpsTimer = 0;
    }
  }

  /** One whole frame: the simulation and then the picture. */
  function frame(now) {
    requestAnimationFrame(frame);
    const delta = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    simulate(delta);
    draw(delta);
  }

  announce(`${GAME.title}. Press ENTER to start a sortie.`);

  // --- The still-picture mode. The scene is staged, drawn once and read back
  // from the canvas; there is no animation loop, so the picture is exactly the
  // frame that was asked for.
  if (shotMode) {
    window.__aether = {
      game, flight, mission, scene, camera, renderer, hud, hudCanvas, canvas, world, rig, aircraft, trails, menus,
      simulate,
      draw,
      startMission,
      beginFlight,
      endMission,
      setScreen(name) {
        game.screen = name;
      },
    };
    stageShot(new URLSearchParams(window.location.search).get('shot') ?? 'cover', window.__aether);
  } else {
    requestAnimationFrame(frame);
  }

  return {
    game,
    flight,
    mission,
    /** The touch controls: the on-screen stick and throttle. */
    setTouch(pitch, roll, throttleChange) {
      input.setTouch(pitch, roll, throttleChange);
    },
    setThrottle(value) {
      input.throttle = value;
    },
    toggleView() {
      rig.toggle();
    },
    setBrake(value) {
      input.setBrake(value);
    },
  };
}

/**
 * Chooses the quality preset from what the machine can do: a small screen or a
 * weak GPU starts on low, and a large one with plenty of memory starts on high.
 */
function detectQuality(renderer) {
  const memory = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const gl = renderer.getContext();
  const rendererName = String(gl.getParameter(gl.RENDERER) ?? '');
  const software = /swiftshader|llvmpipe|software/i.test(rendererName);
  if (software || memory <= 4 || cores <= 4) return { ...QUALITY.low, key: 'low' };
  if (memory >= 12 && cores >= 12) return { ...QUALITY.high, key: 'high' };
  return { ...QUALITY.high, key: 'high' };
}
