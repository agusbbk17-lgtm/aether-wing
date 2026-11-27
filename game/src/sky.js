// The sky: a dome carrying a painted gradient with the sun in it, a ring of
// volumetric-looking cumulus, and the haze that softens the horizon.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE, WORLD } from './config.js';
import { createCloudTexture, createSkyTexture } from './textures.js';

/**
 * The sky dome and its clouds.
 * @param {object} quality the quality preset in force
 * @param {THREE.Vector3} sun the direction the sun stands in
 */
export function createSky(quality, sun) {
  const group = new THREE.Group();

  // --- The dome: a big sphere, painted inside, that never moves.
  const skyTexture = createSkyTexture(quality, PALETTE, sun);
  const skyGeometry = new THREE.SphereGeometry(28000, 40, 24);
  const skyMaterial = new THREE.MeshBasicMaterial({
    map: skyTexture,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(skyGeometry, skyMaterial);
  dome.renderOrder = -10;
  group.add(dome);

  // --- The sun itself: a bright disc, and a halo around it.
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: PALETTE.sun, transparent: true, opacity: 0.95, depthWrite: false, fog: false,
  });
  const disc = new THREE.Mesh(new THREE.SphereGeometry(340, 16, 12), sunMaterial);
  disc.position.copy(sun).multiplyScalar(22000);
  disc.renderOrder = -9;
  group.add(disc);

  const haloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffeec6, transparent: true, opacity: 0.28, depthWrite: false, fog: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(900, 16, 12), haloMaterial);
  halo.position.copy(disc.position);
  halo.renderOrder = -9;
  group.add(halo);

  // --- The clouds: billboards of soft puffs, in a ring around the island, at
  // the heights fair-weather cumulus build at. They are kept out over the sea,
  // beyond the coast, and their bases above the highest ring of the course: a
  // cloud that hung between the aeroplane and the island would veil the ground
  // instead of giving the horizon its depth.
  const cloudTexture = createCloudTexture();
  const cloudMaterial = new THREE.SpriteMaterial({
    map: cloudTexture.map,
    transparent: true,
    depthWrite: false,
    opacity: 0.85,
    fog: true,
  });
  const cloudCount = quality.clouds;
  const clouds = [];
  for (let index = 0; index < cloudCount; index += 1) {
    const material = cloudMaterial.clone();
    const sprite = new THREE.Sprite(material);
    const angle = (index / cloudCount) * Math.PI * 2 + Math.sin(index * 12.9898) * 0.6;
    // The deck is held well out from the course and well above it: the widest
    // the flight gets is about 2.9 kilometres from the island's centre and the
    // rings top out at 645 metres, so a cloud nearer than this or lower would
    // hang between the aeroplane and the ground and veil the island.
    const radius = 5200 + ((index * 7919) % 7600);
    const height = 1650 + ((index * 104729) % 700);
    sprite.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    const scale = 1000 + ((index * 31337) % 1400);
    sprite.scale.set(scale, scale * 0.45, 1);
    material.opacity = 0.3 + ((index * 17) % 26) / 100;
    group.add(sprite);
    clouds.push({ sprite, speed: 0.55 + ((index * 61) % 100) / 100 });
  }

  return {
    group,
    dome,
    disc,
    clouds,
    /** Keeps the dome and the sun around the camera, and drifts the clouds. */
    update(cameraPosition, time) {
      dome.position.copy(cameraPosition);
      disc.position.copy(sun).multiplyScalar(22000).add(cameraPosition);
      halo.position.copy(disc.position);
      clouds.forEach((cloud) => {
        cloud.sprite.position.x += cloud.speed * 0.16;
        if (cloud.sprite.position.x > 12000) cloud.sprite.position.x = -12000;
      });
    },
  };
}
