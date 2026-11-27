// The Aerodyne Kestrel: a low-wing single-engine racer, built out of geometry and
// painted with the procedural maps from textures.js. Nothing here is loaded.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE } from './config.js';

/**
 * A tapered wing panel: a flat, tapered slab with a rounded tip.
 */
function wingGeometry(span, rootChord, tipChord, thickness, sweep) {
  const segments = 8;
  const vertices = [];
  const indices = [];
  const uvs = [];

  for (let side = 0; side < 2; side += 1) {
    const sign = side === 0 ? 1 : -1;
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const x = sign * t * (span / 2);
      const chord = rootChord + (tipChord - rootChord) * t;
      const z = -sweep * t;
      const half = thickness * (1 - t * 0.55) * 0.5;
      vertices.push(x, half, z, x, -half, z, x, half, z - chord, x, -half, z - chord);
      const u = t * 1.2;
      uvs.push(u, 0.02, u, 0.98, u, 0.02, u, 0.98);
      uvs.push(u, 0.02, u, 0.98, u, 0.02, u, 0.98);
    }
  }

  // The top and bottom skins of both panels.
  const perPanel = (segments + 1) * 4;
  for (let side = 0; side < 2; side += 1) {
    const base = side * perPanel;
    for (let index = 0; index < segments; index += 1) {
      const a = base + index * 4;
      const b = base + (index + 1) * 4;
      // Top skin.
      indices.push(a + 2, b + 2, a + 0, b + 2, b + 0, a + 0);
      // Bottom skin.
      indices.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1);
      // Trailing edge.
      indices.push(a + 1, a + 0, b + 1, b + 0, b + 1, a + 0);
      // Leading edge.
      indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, a + 2);
    }
    const last = base + segments * 4;
    indices.push(last + 0, last + 1, last + 2, last + 1, last + 3, last + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A smooth, tapering body of revolution: the fuselage.
 */
function fuselageGeometry(length, radius, segments, rings) {
  const vertices = [];
  const indices = [];
  const uvs = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const z = length * (0.5 - t);
    // The shape of the section: round at the tail, deep at the wing, pointed at the nose.
    const profile = Math.sin(Math.pow(t, 0.72) * Math.PI) * 0.95 + 0.05;
    const r = radius * profile;
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      vertices.push(Math.cos(angle) * r, Math.sin(angle) * r * 0.86, z);
      uvs.push(index / segments, t);
    }
  }
  const stride = segments + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let index = 0; index < segments; index += 1) {
      const a = ring * stride + index;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The whole aeroplane, as a group of meshes the flight model drives.
 * @param {object} textures the painted maps from textures.js
 */
export function createAircraft(textures) {
  const group = new THREE.Group();
  group.name = 'kestrel';

  const skin = new THREE.MeshStandardMaterial({
    map: textures.map,
    normalMap: textures.normalMap,
    roughnessMap: textures.roughnessMap,
    metalness: 0.62,
    roughness: 0.46,
    envMapIntensity: 0.9,
  });
  const paint = new THREE.MeshStandardMaterial({
    color: PALETTE.trim,
    metalness: 0.35,
    roughness: 0.42,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: PALETTE.canopy,
    metalness: 0.1,
    roughness: 0.12,
    transparent: true,
    opacity: 0.55,
    envMapIntensity: 1.4,
  });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.1, roughness: 0.85 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8b9298, metalness: 0.85, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffd27a });

  // The fuselage.
  const body = new THREE.Mesh(fuselageGeometry(7.4, 0.72, 18, 22), skin);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // The cowl: the engine's blunt nose, in the racing trim colour.
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.52, 1.1, 18, 1, true), paint);
  cowl.rotation.x = Math.PI / 2;
  cowl.position.set(0, 0.02, -3.3);
  cowl.castShadow = true;
  group.add(cowl);

  // The spinner and its propeller: the propeller is turned every frame.
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 14), metal);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.set(0, 0.02, -3.85);
  group.add(spinner);

  const propeller = new THREE.Group();
  propeller.position.set(0, 0.02, -3.78);
  for (let blade = 0; blade < 3; blade += 1) {
    const shape = new THREE.Shape();
    shape.moveTo(0.08, 0);
    shape.quadraticCurveTo(0.34, 0.5, 0.14, 1.35);
    shape.quadraticCurveTo(0.02, 1.5, -0.06, 1.3);
    shape.quadraticCurveTo(-0.1, 0.5, -0.08, 0);
    const bladeMesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({
      color: 0x2a2d31, metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide,
    }));
    bladeMesh.rotation.z = (blade / 3) * Math.PI * 2;
    propeller.add(bladeMesh);
  }
  group.add(propeller);

  // The propeller's blur: once it is turning there is nothing to see but a
  // translucent disc, so the blades are veiled by a disc painted from a radial
  // gradient. Its veil thickens with the throttle, and never quite hides the
  // blades at idle.
  const blurSize = 128;
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = blurSize;
  blurCanvas.height = blurSize;
  const blurPaint = blurCanvas.getContext('2d');
  const veil = blurPaint.createRadialGradient(64, 64, 4, 64, 64, 64);
  veil.addColorStop(0, 'rgba(150,157,165,0)');
  veil.addColorStop(0.34, 'rgba(126,133,142,0.16)');
  veil.addColorStop(0.68, 'rgba(96,103,112,0.30)');
  veil.addColorStop(0.95, 'rgba(64,70,78,0.42)');
  veil.addColorStop(1, 'rgba(64,70,78,0)');
  blurPaint.fillStyle = veil;
  blurPaint.fillRect(0, 0, blurSize, blurSize);
  const propBlur = new THREE.Mesh(new THREE.CircleGeometry(1.58, 44), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(blurCanvas),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
  propBlur.position.set(0, 0.02, -3.79);
  group.add(propBlur);

  // The wings, low and slightly swept.
  const wing = new THREE.Mesh(wingGeometry(10.4, 1.85, 1.05, 0.26, 0.55), skin);
  wing.position.set(0, -0.28, -0.15);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  // The wingtips: small fairings that catch the light.
  const tipGeometry = new THREE.SphereGeometry(0.14, 10, 8);
  const tipLeft = new THREE.Mesh(tipGeometry, paint);
  tipLeft.position.set(-5.2, -0.24, -0.72);
  const tipRight = new THREE.Mesh(tipGeometry, paint);
  tipRight.position.set(5.2, -0.24, -0.72);
  group.add(tipLeft, tipRight);

  // The tail: a fin and a horizontal stabiliser.
  const fin = new THREE.Mesh(wingGeometry(1.9, 1.5, 0.75, 0.16, 0.7), skin);
  fin.rotation.z = Math.PI / 2;
  fin.position.set(0, 0.72, 3.0);
  fin.castShadow = true;
  group.add(fin);

  const tail = new THREE.Mesh(wingGeometry(3.6, 1.1, 0.6, 0.14, 0.4), skin);
  tail.position.set(0, 0.12, 2.95);
  tail.castShadow = true;
  group.add(tail);

  // The canopy: a bubble over the cockpit.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.52, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), glass);
  canopy.position.set(0, 0.5, -0.85);
  canopy.scale.set(1, 0.85, 1.9);
  group.add(canopy);

  // The pilot's seat and the headrest, visible through the glass.
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.16), new THREE.MeshStandardMaterial({ color: 0x2a2119, roughness: 0.9 }));
  seat.position.set(0, 0.42, -0.45);
  group.add(seat);

  // The wheels: two mains under the wings and a tailwheel.
  const wheelGeometry = new THREE.TorusGeometry(0.3, 0.11, 8, 16);
  const gear = [];
  const leftGear = new THREE.Mesh(wheelGeometry, rubber);
  leftGear.position.set(-1.5, -1.05, -0.1);
  const rightGear = new THREE.Mesh(wheelGeometry, rubber);
  rightGear.position.set(1.5, -1.05, -0.1);
  const tailWheel = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.05, 6, 10), rubber);
  tailWheel.position.set(0, -0.05, 3.1);
  gear.push(leftGear, rightGear, tailWheel);
  gear.forEach((wheel) => group.add(wheel));

  // The struts that hold the wheels.
  const strutGeometry = new THREE.CylinderGeometry(0.055, 0.055, 0.9, 8);
  const leftStrut = new THREE.Mesh(strutGeometry, metal);
  leftStrut.position.set(-1.5, -0.6, -0.1);
  const rightStrut = new THREE.Mesh(strutGeometry, metal);
  rightStrut.position.set(1.5, -0.6, -0.1);
  group.add(leftStrut, rightStrut);

  // The exhaust stubs and the exhaust flame's glow.
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 8), metal);
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.32, -0.22, -3.1);
  group.add(exhaust);

  const exhaustGlow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glow);
  exhaustGlow.position.set(0.32, -0.22, -3.5);
  exhaustGlow.visible = false;
  group.add(exhaustGlow);

  // The landing lights: two small lamps in the wing's leading edge.
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3cf });
  const lamps = [];
  [-4.4, 4.4].forEach((x) => {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), lampMaterial);
    lamp.position.set(x, -0.2, -0.55);
    lamps.push(lamp);
    group.add(lamp);
  });

  // The control surfaces: the ailerons, the elevator and the rudder, which move
  // with the pilot's hands.
  const surfaceMaterial = skin.clone();
  surfaceMaterial.color = new THREE.Color(PALETTE.hullShade);
  const aileronLeft = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.07, 0.42), surfaceMaterial);
  aileronLeft.position.set(-3.7, -0.28, 1.05);
  const aileronRight = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.07, 0.42), surfaceMaterial);
  aileronRight.position.set(3.7, -0.28, 1.05);
  const elevator = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.06, 0.4), surfaceMaterial);
  elevator.position.set(0, 0.12, 3.5);
  const rudder = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.6), surfaceMaterial);
  rudder.position.set(0, 0.85, 3.45);
  group.add(aileronLeft, aileronRight, elevator, rudder);

  // The flaps, which drop with the flap lever.
  const flapLeft = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.36), surfaceMaterial);
  flapLeft.position.set(-1.5, -0.3, 1.0);
  const flapRight = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.36), surfaceMaterial);
  flapRight.position.set(1.5, -0.3, 1.0);
  group.add(flapLeft, flapRight);

  return {
    group,
    propeller,
    propBlur,
    exhaustGlow,
    lamps,
    surfaces: { aileronLeft, aileronRight, elevator, rudder, flapLeft, flapRight },
    /** Turns the propeller and moves the control surfaces with the pilot's hands. */
    update(flight, axes, delta, throttle) {
      const spin = 12 + throttle * 62;
      propeller.rotation.z += delta * spin;
      propBlur.material.opacity = Math.min(0.92, spin * 0.011);
      const roll = axes.roll;
      aileronLeft.rotation.x = roll * 0.5;
      aileronRight.rotation.x = -roll * 0.5;
      elevator.rotation.x = -axes.pitch * 0.45;
      rudder.rotation.y = -axes.yaw * 0.5;
      const flapAngle = flight.state.flaps * 0.6;
      flapLeft.rotation.x = flapAngle;
      flapRight.rotation.x = flapAngle;
      exhaustGlow.visible = throttle > 0.55;
      const glowScale = 0.6 + throttle * 0.9 + Math.sin(performance.now() * 0.03) * 0.12;
      exhaustGlow.scale.setScalar(glowScale);
      lamps.forEach((lamp) => {
        lamp.material.color.setHex(flight.state.onGround ? 0xfff3cf : 0xd8dde0);
      });
    },
  };
}
