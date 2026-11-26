// Sable Reach: the island, the sea around it, the sky above it and everything
// standing on it. The terrain is one mesh with four splat-mapped layers; the sea
// is a separate plane with animated normals; the forest, the buildings and the
// rocks are instanced so the whole place stays cheap to draw.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE, WORLD } from './config.js';
import { createRandom, hash2, smoothstep } from './random.js';
import { airfieldHeightAt, createShorelineMask, heightAt, ISLAND_SEED, slopeAt, splatWeights } from './terrain.js';
import { createGroundTextures, createWaterTextures } from './textures.js';

/**
 * The shader that blends the four ground layers by the weights the terrain's
 * vertex colours carry, and adds a detail normal so the ground stays sharp
 * when the camera is low over it.
 */
const TERRAIN_VERTEX = `
  attribute vec4 splat;
  attribute float detail;
  varying vec4 vSplat;
  varying float vDetail;
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vSplat = splat;
    vDetail = detail;
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const TERRAIN_FRAGMENT = `
  uniform sampler2D grassMap;
  uniform sampler2D grassNormal;
  uniform sampler2D grassRough;
  uniform sampler2D rockMap;
  uniform sampler2D rockNormal;
  uniform sampler2D rockRough;
  uniform sampler2D sandMap;
  uniform sampler2D sandNormal;
  uniform sampler2D sandRough;
  uniform sampler2D snowMap;
  uniform sampler2D snowNormal;
  uniform sampler2D snowRough;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform vec3 groundColor;
  uniform float fogDensity;
  uniform vec3 fogColor;
  uniform float detailScale;

  varying vec4 vSplat;
  varying float vDetail;
  varying vec3 vWorld;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv * 120.0;
    vec4 grass = texture2D(grassMap, uv);
    vec4 rock = texture2D(rockMap, uv * 0.8);
    vec4 sand = texture2D(sandMap, uv * 0.9);
    vec4 snow = texture2D(snowMap, uv * 0.7);

    vec3 albedo = grass.rgb * vSplat.x + rock.rgb * vSplat.y + sand.rgb * vSplat.z + snow.rgb * vSplat.w;
    float roughness = texture2D(grassRough, uv).g * vSplat.x + texture2D(rockRough, uv * 0.8).g * vSplat.y + texture2D(sandRough, uv * 0.9).g * vSplat.z + texture2D(snowRough, uv * 0.7).g * vSplat.w;

    // The detail normal: a second, finer set of normals that keeps the ground
    // sharp when the camera is close to it.
    vec2 detailUv = vUv * 900.0;
    vec3 detailNormal = texture2D(grassNormal, detailUv).xyz * 2.0 - 1.0;
    vec3 grassN = texture2D(grassNormal, uv).xyz * 2.0 - 1.0;
    vec3 rockN = texture2D(rockNormal, uv * 0.8).xyz * 2.0 - 1.0;
    vec3 sandN = texture2D(sandNormal, uv * 0.9).xyz * 2.0 - 1.0;
    vec3 snowN = texture2D(snowNormal, uv * 0.7).xyz * 2.0 - 1.0;
    vec3 normal = normalize(
      grassN * vSplat.x + rockN * vSplat.y + sandN * vSplat.z + snowN * vSplat.w + detailNormal * vDetail * 0.35);

    vec3 lightDirection = normalize(sunDirection);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float ambient = 0.42 + 0.18 * normal.y;
    vec3 color = albedo * (sunColor * diffuse * 1.25 + skyColor * ambient * 0.55 + groundColor * ambient * 0.2);

    // The haze, at the same density as the scene's fog.
    // The haze: an exponential falloff with distance, so the far side of the
    // island softens but the ground under the aeroplane stays crisp.
    float distance = length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-fogDensity * fogDensity * distance * distance);
    color = mix(color, fogColor, clamp(fog, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The sea's shader: two scrolling normal maps, a sun glint and a foam line at the shore. */
const WATER_VERTEX = `
  varying vec3 vWorld;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const WATER_FRAGMENT = `
  uniform sampler2D normalMap;
  uniform sampler2D roughnessMap;
  uniform sampler2D shoreMask;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform vec3 deepColor;
  uniform vec3 shallowColor;
  uniform vec3 fogColor;
  uniform float fogDensity;
  uniform float time;

  varying vec3 vWorld;
  varying vec2 vUv;

  void main() {
    vec2 uvA = vWorld.xz * 0.012 + vec2(time * 0.011, time * 0.007);
    vec2 uvB = vWorld.xz * 0.035 - vec2(time * 0.017, time * 0.013);
    vec3 normalA = texture2D(normalMap, uvA).xyz * 2.0 - 1.0;
    vec3 normalB = texture2D(normalMap, uvB).xyz * 2.0 - 1.0;
    vec3 normal = normalize(vec3(normalA.x + normalB.x, 6.0, normalA.y + normalB.y));

    vec3 view = normalize(cameraPosition - vWorld);
    vec3 light = normalize(sunDirection);
    vec3 halfway = normalize(view + light);
    float specular = pow(max(dot(normal, halfway), 0.0), 220.0);
    float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 4.0);

    // The sea is shallower over the island's shelf.
    float shelf = smoothstep(-260.0, 40.0, vWorld.y);
    vec3 base = mix(deepColor, shallowColor, shelf * 0.75 + 0.1);
    vec3 color = base + sunColor * specular * 1.7 + vec3(0.55, 0.68, 0.78) * fresnel * 0.6;

    // The foam line: where the waves break on the sand. The mask says how
    // close the shore is, and the ripples along it move with the swell.
    vec2 shoreUv = vWorld.xz / 9600.0 + 0.5;
    float shore = 0.0;
    if (shoreUv.x > 0.0 && shoreUv.x < 1.0 && shoreUv.y > 0.0 && shoreUv.y < 1.0) {
      shore = texture2D(shoreMask, shoreUv).r;
    }
    float swell = sin(vWorld.x * 0.02 + vWorld.z * 0.014 + time * 1.6) * 0.5 + 0.5;
    float foam = smoothstep(0.35, 0.95, shore * (0.65 + swell * 0.55));
    foam *= smoothstep(-6.0, 2.0, vWorld.y);
    color = mix(color, vec3(0.91, 0.96, 0.97), foam * 0.85);

    // The haze: an exponential falloff with distance, so the far side of the
    // island softens but the ground under the aeroplane stays crisp.
    float distance = length(vWorld - cameraPosition);
    float fog = 1.0 - exp(-fogDensity * fogDensity * distance * distance);
    color = mix(color, fogColor, clamp(fog, 0.0, 1.0));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The sun's position in the world, from the elevation and the azimuth in config. */
export function sunDirection() {
  const elevation = WORLD.sunElevation;
  const azimuth = WORLD.sunAzimuth;
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ).normalize();
}

/**
 * The whole world: the meshes, the lights and the animated pieces.
 * @param {object} quality the quality preset in force
 */
export function createWorld(quality, renderer) {
  const group = new THREE.Group();
  const seed = ISLAND_SEED;
  const random = createRandom(seed);
  const sun = sunDirection();

  // --- The lights: the sun, the sky's fill and the bounce off the ground.
  const sunLight = new THREE.DirectionalLight(PALETTE.sunLight, 2.6);
  sunLight.position.copy(sun).multiplyScalar(3000);
  sunLight.castShadow = quality.shadows;
  sunLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sunLight.shadow.camera.near = 100;
  sunLight.shadow.camera.far = 6000;
  sunLight.shadow.camera.left = -700;
  sunLight.shadow.camera.right = 700;
  sunLight.shadow.camera.top = 700;
  sunLight.shadow.camera.bottom = -700;
  sunLight.shadow.bias = -0.0008;
  sunLight.shadow.normalBias = 0.6;
  group.add(sunLight);
  group.add(sunLight.target);

  const skyLight = new THREE.HemisphereLight(0xa8cbe8, PALETTE.groundBounce, 1.15);
  group.add(skyLight);

  // --- The terrain: one mesh, four layers, blended by the vertex colours.
  const groundTextures = createGroundTextures(quality);
  const segments = quality.terrainSegments;
  const size = WORLD.terrainSize;
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  const splat = new Float32Array(posAttr.count * 4);
  const detail = new Float32Array(posAttr.count);
  for (let index = 0; index < posAttr.count; index += 1) {
    const x = posAttr.getX(index);
    const z = posAttr.getZ(index);
    const height = heightAt(x, z, seed);
    posAttr.setY(index, height);
    const slope = slopeAt(x, z, seed);
    const weights = splatWeights(x, z, height, slope, seed);
    splat[index * 4] = weights.grass;
    splat[index * 4 + 1] = weights.rock;
    splat[index * 4 + 2] = weights.sand;
    splat[index * 4 + 3] = weights.snow;
    detail[index] = smoothstep(600, 120, Math.hypot(x, z)) * 0.9;
  }
  geometry.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  geometry.setAttribute('detail', new THREE.BufferAttribute(detail, 1));
  geometry.computeVertexNormals();

  const terrainMaterial = new THREE.ShaderMaterial({
    uniforms: {
      grassMap: { value: groundTextures.grass.map },
      grassNormal: { value: groundTextures.grass.normalMap },
      grassRough: { value: groundTextures.grass.roughnessMap },
      rockMap: { value: groundTextures.rock.map },
      rockNormal: { value: groundTextures.rock.normalMap },
      rockRough: { value: groundTextures.rock.roughnessMap },
      sandMap: { value: groundTextures.sand.map },
      sandNormal: { value: groundTextures.sand.normalMap },
      sandRough: { value: groundTextures.sand.roughnessMap },
      snowMap: { value: groundTextures.snow.map },
      snowNormal: { value: groundTextures.snow.normalMap },
      snowRough: { value: groundTextures.snow.roughnessMap },
      sunDirection: { value: sun },
      sunColor: { value: new THREE.Color(PALETTE.sunLight) },
      skyColor: { value: new THREE.Color(PALETTE.skyHorizon) },
      groundColor: { value: new THREE.Color(PALETTE.groundBounce) },
      fogColor: { value: new THREE.Color(PALETTE.fog) },
      fogDensity: { value: WORLD.fogDensity },
      detailScale: { value: 1 },
    },
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
  });

  const terrain = new THREE.Mesh(geometry, terrainMaterial);
  terrain.receiveShadow = quality.shadows;
  terrain.name = 'terrain';
  group.add(terrain);

  // --- The sea: a great plane under everything, with scrolling ripples.
  const waterTextures = createWaterTextures(quality);
  // The shoreline mask: baked on the CPU, so the sea knows where the sand is.
  const shoreline = createShorelineMask(quality.shoreMaskSize ?? 256, 4800);
  const shoreTexture = new THREE.DataTexture(
    shoreline.data, shoreline.size, shoreline.size, THREE.RedFormat, THREE.UnsignedByteType,
  );
  shoreTexture.wrapS = THREE.ClampToEdgeWrapping;
  shoreTexture.wrapT = THREE.ClampToEdgeWrapping;
  shoreTexture.minFilter = THREE.LinearFilter;
  shoreTexture.magFilter = THREE.LinearFilter;
  shoreTexture.needsUpdate = true;
  const waterGeometry = new THREE.PlaneGeometry(WORLD.seaSize, WORLD.seaSize, 1, 1);
  waterGeometry.rotateX(-Math.PI / 2);
  const waterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      normalMap: { value: waterTextures.normalMap },
      roughnessMap: { value: waterTextures.roughnessMap },
      shoreMask: { value: shoreTexture },
      sunDirection: { value: sun },
      sunColor: { value: new THREE.Color(PALETTE.sunLight) },
      deepColor: { value: new THREE.Color(PALETTE.seaDeep) },
      shallowColor: { value: new THREE.Color(PALETTE.seaShallow) },
      fogColor: { value: new THREE.Color(PALETTE.fog) },
      fogDensity: { value: WORLD.fogDensity * 0.75 },
      time: { value: 0 },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
  });
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.position.y = 0;
  water.renderOrder = -1;
  group.add(water);

  // --- The runway: a strip of asphalt with its markings, its threshold bars
  // and its edge lights, laid on the airfield's shelf.
  const runwayGroup = new THREE.Group();
  const asphaltTextures = createGroundTextures(quality);
  const runwayMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.asphalt,
    roughness: 0.92,
    metalness: 0.02,
  });
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.runwayWidth, WORLD.runwayLength, 1, 1),
    runwayMaterial,
  );
  runway.rotation.x = -Math.PI / 2;
  runway.position.set(0, WORLD.airfieldHeight + 0.06, 0);
  runway.receiveShadow = quality.shadows;
  runwayGroup.add(runway);

  // The centre line: dashes down the middle of the strip.
  const markingMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.marking, roughness: 0.75, metalness: 0.02,
  });
  const dashGeometry = new THREE.PlaneGeometry(1.1, 26);
  for (let z = -WORLD.runwayLength / 2 + 60; z < WORLD.runwayLength / 2 - 60; z += 46) {
    const dash = new THREE.Mesh(dashGeometry, markingMaterial);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, WORLD.airfieldHeight + 0.09, z);
    runwayGroup.add(dash);
  }
  // The threshold bars at each end, and the runway's edge lines.
  const thresholdGeometry = new THREE.PlaneGeometry(3.2, 34);
  [-1, 1].forEach((end) => {
    for (let lane = -6; lane <= 6; lane += 1) {
      if (lane === 0) continue;
      const bar = new THREE.Mesh(thresholdGeometry, markingMaterial);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(lane * 3.4, WORLD.airfieldHeight + 0.09, end * (WORLD.runwayLength / 2 - 40));
      runwayGroup.add(bar);
    }
  });
  const edgeGeometry = new THREE.PlaneGeometry(0.9, WORLD.runwayLength);
  [-1, 1].forEach((side) => {
    const edge = new THREE.Mesh(edgeGeometry, markingMaterial);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(side * (WORLD.runwayWidth / 2 - 3), WORLD.airfieldHeight + 0.09, 0);
    runwayGroup.add(edge);
  });

  // The runway's edge lights: small glowing beads down both sides.
  const lightGeometry = new THREE.SphereGeometry(0.55, 6, 5);
  const edgeLightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
  const runwayLights = new THREE.InstancedMesh(lightGeometry, edgeLightMaterial, 80);
  const matrix = new THREE.Matrix4();
  let lightIndex = 0;
  for (let index = 0; index < 40; index += 1) {
    const z = -WORLD.runwayLength / 2 + (index / 39) * WORLD.runwayLength;
    [-1, 1].forEach((side) => {
      matrix.makeTranslation(side * (WORLD.runwayWidth / 2 + 1.5), WORLD.airfieldHeight + 0.5, z);
      runwayLights.setMatrixAt(lightIndex, matrix);
      lightIndex += 1;
    });
  }
  runwayLights.instanceMatrix.needsUpdate = true;
  runwayGroup.add(runwayLights);

  // The glow around each light: a bigger, additive bead that makes the strip
  // read as lit at dusk and from the air.
  const glowGeometry = new THREE.SphereGeometry(1.7, 8, 6);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe0a0,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const runwayGlows = new THREE.InstancedMesh(glowGeometry, glowMaterial, 80);
  const glowMatrix = new THREE.Matrix4();
  for (let index = 0; index < 80; index += 1) {
    runwayLights.getMatrixAt(index, glowMatrix);
    runwayGlows.setMatrixAt(index, glowMatrix);
  }
  runwayGlows.instanceMatrix.needsUpdate = true;
  runwayGlows.renderOrder = 3;
  runwayGroup.add(runwayGlows);
  group.add(runwayGroup);

  // --- The apron and the hangars beside the runway.
  const buildings = new THREE.Group();
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b3a4, roughness: 0.85 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x59636b, roughness: 0.7, metalness: 0.3 });
  const hangarPositions = [
    [-120, 260, 42, 20, 14],
    [-186, 380, 30, 16, 11],
    [-90, 470, 24, 14, 10],
    [150, -300, 34, 18, 12],
    [210, -390, 26, 14, 10],
  ];
  hangarPositions.forEach(([x, z, w, d, h]) => {
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMaterial);
    hangar.position.set(x, WORLD.airfieldHeight + h / 2, z);
    hangar.castShadow = quality.shadows;
    hangar.receiveShadow = quality.shadows;
    buildings.add(hangar);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 14, 1, false, 0, Math.PI), roofMaterial);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.y = Math.PI / 2;
    roof.position.set(x, WORLD.airfieldHeight + h, z);
    roof.castShadow = quality.shadows;
    buildings.add(roof);
  });
  // The control tower: a taller building with a glass cab on top.
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 26, 12), wallMaterial);
  tower.position.set(-62, WORLD.airfieldHeight + 13, -120);
  tower.castShadow = quality.shadows;
  buildings.add(tower);
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(7.5, 7.5, 5, 12), new THREE.MeshStandardMaterial({
    color: 0x30424e, roughness: 0.2, metalness: 0.5,
  }));
  cab.position.set(-62, WORLD.airfieldHeight + 28, -120);
  buildings.add(cab);
  const cabRoof = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.2, 0.7, 12), roofMaterial);
  cabRoof.position.set(-62, WORLD.airfieldHeight + 31, -120);
  buildings.add(cabRoof);
  group.add(buildings);

  // --- The forest: two instanced meshes, a trunk and a canopy, put on the
  // ground where the ground will take them.
  const forest = new THREE.Group();
  const trunkGeometry = new THREE.CylinderGeometry(0.32, 0.5, 6.5, 6);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3a2b, roughness: 0.95 });
  const canopyGeometry = new THREE.ConeGeometry(3.1, 9.5, 7);
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a7034, roughness: 0.9 });
  const treeCount = quality.trees;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const canopies = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, treeCount);
  let placed = 0;
  let attempts = 0;
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  while (placed < treeCount && attempts < treeCount * 24) {
    attempts += 1;
    const x = (random() - 0.5) * WORLD.terrainSize * 0.92;
    const z = (random() - 0.5) * WORLD.terrainSize * 0.92;
    const height = heightAt(x, z, seed);
    if (height < 12 || height > WORLD.snowLine - 20) continue;
    const slope = slopeAt(x, z, seed);
    if (slope > 0.42) continue;
    // Keep the trees off the airfield.
    if (Math.hypot(x, z) < WORLD.airfieldOuter + 120) continue;
    const distance = Math.hypot(x, z);
    if (distance > quality.treeDistance) continue;
    const size = 0.72 + random() * 0.85;
    position.set(x, height + 3.1 * size, z);
    quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2);
    scale.set(size, size, size);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(placed, matrix);
    position.set(x, height + 9.2 * size, z);
    matrix.compose(position, quaternion, scale);
    canopies.setMatrixAt(placed, matrix);
    placed += 1;
  }
  trunks.count = placed;
  canopies.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  trunks.castShadow = quality.shadows;
  canopies.castShadow = quality.shadows;
  canopies.receiveShadow = quality.shadows;
  forest.add(trunks, canopies);
  group.add(forest);

  // --- The rocks: a scatter of boulders over the high ground and the shore.
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.rock, roughness: 0.95, flatShading: true });
  const rockCount = quality.rocks;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockCount);
  let rockPlaced = 0;
  attempts = 0;
  while (rockPlaced < rockCount && attempts < rockCount * 20) {
    attempts += 1;
    const x = (random() - 0.5) * WORLD.terrainSize * 0.95;
    const z = (random() - 0.5) * WORLD.terrainSize * 0.95;
    const height = heightAt(x, z, seed);
    if (height < -2) continue;
    const size = 0.9 + random() * 3.4;
    position.set(x, height + size * 0.35, z);
    quaternion.setFromEuler(new THREE.Euler(random() * 3, random() * 3, random() * 3));
    scale.set(size, size * lerpNumber(0.6, 1.2, random()), size);
    matrix.compose(position, quaternion, scale);
    rocks.setMatrixAt(rockPlaced, matrix);
    rockPlaced += 1;
  }
  rocks.count = rockPlaced;
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = quality.shadows;
  rocks.receiveShadow = quality.shadows;
  group.add(rocks);

  return {
    group,
    terrain,
    water,
    runwayGroup,
    buildings,
    forest,
    rocks,
    sunLight,
    sun,
    /** The point the aeroplane aims for when it is coming home to land. */
    runwayTarget() {
      return new THREE.Vector3(0, WORLD.airfieldHeight + 60, -420);
    },
    /** The scene's fog and the sky's colour, kept in step with the shader. */
    setFog(scene) {
      scene.fog = new THREE.FogExp2(PALETTE.fog, WORLD.fogDensity);
      scene.background = new THREE.Color(PALETTE.skyHorizon);
    },
    /** Moves the sun's shadow camera with the aeroplane, so the shadows stay sharp. */
    followSun(target) {
      sunLight.position.copy(sun).multiplyScalar(1600).add(target);
      sunLight.target.position.copy(target);
      sunLight.target.updateMatrixWorld();
    },
    /** The animated parts: the sea's ripples. */
    update(time) {
      waterMaterial.uniforms.time.value = time;
    },
  };
}

/** A small helper the rock scatter uses. */
function lerpNumber(a, b, t) {
  return a + (b - a) * t;
}
