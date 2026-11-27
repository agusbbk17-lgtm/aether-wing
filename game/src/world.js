// Sable Reach: the island, the sea around it, the sky above it and everything
// standing on it. The terrain is one mesh with four splat-mapped layers; the sea
// is a separate plane with animated normals; the forest, the buildings and the
// rocks are instanced so the whole place stays cheap to draw.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE, WORLD } from './config.js';
import { createRandom, hash2, smoothstep } from './random.js';
import { airfieldHeightAt, createShorelineMask, heightAt, ISLAND_SEED, shelfDistance, slopeAt, splatWeights } from './terrain.js';
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
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vSplat = splat;
    vDetail = detail;
    vUv = uv;
    // The mesh's own normal, in world space: the ground's real slope, which
    // the normal maps then bend. Without it the shading would have nothing to
    // stand on and every hill would read as flat.
    vNormal = normalize(mat3(modelMatrix) * normal);
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
  varying vec3 vNormal;

  void main() {
    vec2 uv = vUv * 120.0;
    vec4 grass = texture2D(grassMap, uv);
    vec4 rock = texture2D(rockMap, uv * 0.8);
    vec4 sand = texture2D(sandMap, uv * 0.9);
    vec4 snow = texture2D(snowMap, uv * 0.7);

    // The splat weights ride on the mesh's vertices, forty metres apart, so a
    // boundary carried only by them reads as a soft smear across the hillside.
    // It is broken up by a coarse blotch of the snow's own roughness map, which
    // moves the line along the ground's real relief and leaves the middle of
    // each layer untouched.
    vec4 weights = vSplat;
    float blotch = texture2D(snowRough, vUv * 26.0).g - 0.5;
    float edge = 4.0 * weights.w * (1.0 - weights.w);
    weights.w = clamp(weights.w + blotch * 1.7 * edge, 0.0, 1.0);
    weights.x = max(0.0, 1.0 - weights.y - weights.z - weights.w);

    vec3 albedo = grass.rgb * weights.x + rock.rgb * weights.y + sand.rgb * weights.z + snow.rgb * weights.w;
    float roughness = texture2D(grassRough, uv).g * weights.x + texture2D(rockRough, uv * 0.8).g * weights.y + texture2D(sandRough, uv * 0.9).g * weights.z + texture2D(snowRough, uv * 0.7).g * weights.w;

    // The detail normal: a second, finer set of normals that keeps the ground
    // sharp when the camera is close to it. Its weight rises near the eye, so
    // the ground under the aeroplane never relaxes into a flat colour.
    float nearEye = 1.0 - clamp((length(vWorld - cameraPosition) - 260.0) / 1500.0, 0.0, 1.0);
    float detailStrength = vDetail + nearEye * 0.55;
    vec2 detailUv = vUv * 900.0;
    vec3 detailNormal = texture2D(grassNormal, detailUv).xyz * 2.0 - 1.0;
    vec3 grassN = texture2D(grassNormal, uv).xyz * 2.0 - 1.0;
    vec3 rockN = texture2D(rockNormal, uv * 0.8).xyz * 2.0 - 1.0;
    vec3 sandN = texture2D(sandNormal, uv * 0.9).xyz * 2.0 - 1.0;
    vec3 snowN = texture2D(snowNormal, uv * 0.7).xyz * 2.0 - 1.0;
    vec3 bend = normalize(
      grassN * weights.x + rockN * weights.y + sandN * weights.z + snowN * weights.w + detailNormal * detailStrength * 0.4);

    // The frame the maps are painted in follows the ground's own layout: the
    // terrain is built along X and Z, so the map's axes are the world's,
    // squared off against the slope the mesh actually has.
    vec3 surface = normalize(vNormal);
    vec3 helper = abs(surface.y) > 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec3 tangent = normalize(cross(helper, surface));
    vec3 bitangent = cross(surface, tangent);
    vec3 normal = normalize(tangent * bend.x + bitangent * bend.y + surface * max(0.4, bend.z));

    vec3 lightDirection = normalize(sunDirection);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    // A shaded slope still faces the sky, so it keeps a fill light: dim, never
    // black. The snow and the wet rock take a sheen along the sun's direction.
    float ambient = 0.34 + 0.26 * max(0.0, normal.y);
    vec3 color = albedo * (sunColor * diffuse * 1.35 + skyColor * ambient * 0.7 + groundColor * ambient * 0.25);
    vec3 toEye = normalize(cameraPosition - vWorld);
    float sheen = pow(max(dot(reflect(-lightDirection, normal), toEye), 0.0), 24.0);
    color += sunColor * sheen * (0.03 + 0.22 * (1.0 - roughness));

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
    vec3 view = normalize(cameraPosition - vWorld);
    float range = length(vWorld - cameraPosition);
    vec3 light = normalize(sunDirection);

    // The sea stands shallow over the bank that rings the island and deep
    // beyond it, which is what gives the coast its turquoise ring. It is read
    // from how far the point lies from the island's centre: the water's own
    // height is the same everywhere on a flat sea, so it carries no news.
    float shelf = 1.0 - smoothstep(3100.0, 6600.0, length(vWorld.xz));

    // Two sets of ripples scroll across each other. They are chopped down as
    // the eye lays flatter on the water and as the water falls away: the same
    // normals read at a grazing angle beat into bands across the whole sea, and
    // a far sea is calm water in any case.
    float chop = smoothstep(0.1, 0.55, max(view.y, 0.0))
      * (1.0 - 0.8 * smoothstep(900.0, 4500.0, range));
    vec2 uvA = vWorld.xz * 0.006 + vec2(time * 0.011, time * 0.007);
    vec2 uvB = vWorld.xz * 0.016 - vec2(time * 0.017, time * 0.013);
    vec3 normalA = texture2D(normalMap, uvA).xyz * 2.0 - 1.0;
    vec3 normalB = texture2D(normalMap, uvB).xyz * 2.0 - 1.0;
    vec3 normal = normalize(vec3(
      (normalA.x + normalB.x * 0.55) * chop, 6.0, (normalA.y + normalB.y * 0.55) * chop));
    float roughness = texture2D(roughnessMap, uvA).g;

    // Sea water is dark and only thinly reflective. The sky is mirrored by a
    // Fresnel term held to water's own reflectivity, so the surface keeps its
    // colour out at the horizon instead of washing into a pale sheet.
    float facing = max(dot(normal, view), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
    vec3 halfway = normalize(view + light);
    float glint = pow(max(dot(normal, halfway), 0.0), 300.0) * (1.2 - roughness);

    vec3 base = mix(deepColor, shallowColor, 0.08 + shelf * 0.72);
    vec3 color = base * (0.78 + 0.22 * max(light.y, 0.0));
    color = mix(color, fogColor, fresnel * 0.22);
    color += sunColor * glint * 0.9;

    // The foam line: where the waves break on the sand. The mask says how
    // close the shore is, and the ripples along it move with the swell.
    vec2 shoreUv = vWorld.xz / 9600.0 + 0.5;
    float shore = 0.0;
    if (shoreUv.x > 0.0 && shoreUv.x < 1.0 && shoreUv.y > 0.0 && shoreUv.y < 1.0) {
      shore = texture2D(shoreMask, shoreUv).r;
    }
    // The break only shows where the bank is shallow under it, and only within
    // a couple of kilometres of the eye: a swell of this wavelength sampled
    // across a long, flat sea folds into bands that run right out to the
    // horizon, which reads as a screen artefact rather than as surf.
    float swell = sin(vWorld.x * 0.008 + vWorld.z * 0.006 + time * 1.6) * 0.5 + 0.5;
    float foam = smoothstep(0.5, 0.98, shore * (0.72 + swell * 0.28));
    foam *= smoothstep(0.04, 0.4, shelf) * (1.0 - smoothstep(1100.0, 4200.0, range));
    color = mix(color, vec3(0.91, 0.96, 0.97), foam * 0.7);

    // The haze: an exponential falloff with distance, so the far side of the
    // island softens but the ground under the aeroplane stays crisp.
    float fog = 1.0 - exp(-fogDensity * fogDensity * range * range);
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
    // Keep the trees off the airfield and its approaches.
    if (shelfDistance(x, z) < WORLD.airfieldOuter + 120) continue;
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
