// The shape of Sable Reach: one height function that both the terrain mesh and the
// flight model ask, so the aeroplane never flies through a hill the picture shows.
// The island rises from the sea, flattens into a shelf for the airfield, and carries
// a ridged mountain range to the north-west with a snow line on its shoulders.
import { WORLD } from './config.js';
import { fbm2, ridged2, smoothstep } from './random.js';

/** The default seed of the island. */
export const ISLAND_SEED = 20261126;

/**
 * How far the airfield's level shelf reaches at a point: 1 on the flat ground
 * under the strip and its approaches, 0 outside it. The shelf is an ellipse
 * stretched along the runway, so the approaches are clear.
 * @param {number} x the easting, in metres
 * @param {number} z the southing, in metres
 */
export function shelfBlend(x, z) {
  return smoothstep(WORLD.airfieldOuter, WORLD.airfieldInner,
    Math.hypot(x, z * WORLD.airfieldStretch));
}

/**
 * The distance from the airfield's centre measured along the shelf's own
 * ellipse, in metres: the same yardstick the trees and the splat map keep off.
 */
export function shelfDistance(x, z) {
  return Math.hypot(x, z * WORLD.airfieldStretch);
}

/**
 * The height of the ground, in metres above the sea, at a point in the world.
 * @param {number} x the easting, in metres
 * @param {number} z the southing, in metres
 * @param {number} seed the island's seed
 */
export function heightAt(x, z, seed = ISLAND_SEED) {
  const half = WORLD.terrainSize * 0.5;
  const nx = x / 4200;
  const nz = z / 4200;

  // The island's mask: a soft ellipse, so the coast is a curve and not a square.
  const radius = Math.sqrt((x / 1.05) ** 2 + (z / 1.28) ** 2);
  const island = smoothstep(1.02, 0.62, radius / 3600);

  // The broad shape of the land: rolling ground.
  const rolling = fbm2(nx * 0.9, nz * 0.9, seed, 5) - 0.42;

  // The mountain range: ridged noise, stronger to the north-west.
  const ridgeMask = smoothstep(-0.2, 0.85, (-x - z) / 3600);
  const ridge = ridged2(nx * 1.5 + 11.3, nz * 1.5 - 4.7, seed + 77, 5);

  let height = island * (34 + rolling * 300 + ridge * ridgeMask * 430);

  // A shelf for the airfield: level ground under the strip and its approaches,
  // an ellipse stretched along the runway so the hills do not rise in front of
  // the threshold, blending into the country beyond.
  const flat = shelfBlend(x, z);
  height = height * (1 - flat) + WORLD.airfieldHeight * flat;

  // The beach: the ground never goes far below the sea, so the coast has a shore.
  height = Math.max(height, -6);

  // Outside the patch the ground falls away to the sea.
  const edge = smoothstep(half, half * 0.86, Math.max(Math.abs(x), Math.abs(z)));
  height *= edge;

  return height;
}

/**
 * How steeply the ground slopes at a point, as a number in 0..1 (0 is flat).
 */
export function slopeAt(x, z, seed = ISLAND_SEED) {
  const d = 26;
  const hx = heightAt(x + d, z, seed) - heightAt(x - d, z, seed);
  const hz = heightAt(x, z + d, seed) - heightAt(x, z - d, seed);
  const gradient = Math.hypot(hx, hz) / (2 * d);
  return Math.min(1, gradient / 1.2);
}

/**
 * The four weights of the ground's splat map at a point: grass, rock, sand and snow.
 * The ground is grass where it is low and flat, rock where it is steep, sand along
 * the shore and snow high on the peaks.
 */
export function splatWeights(x, z, height, slope, seed = ISLAND_SEED) {
  // The shore is sand; the airfield's shelf is low ground but it is inland, so
  // the sand rule does not apply to it and it stays mown grass.
  const shelf = shelfBlend(x, z);
  const sand = smoothstep(WORLD.sandLine + 12, WORLD.sandLine - 4, height) * (1 - shelf * 0.94);
  const rock = smoothstep(0.24, 0.55, slope) * (1 - sand * 0.6);
  // Snow lies on the high ground, but not on a face too steep to hold it: the
  // ramp is narrow so the summits are capped and the shoulders stay rock.
  const snow = smoothstep(WORLD.snowLine, WORLD.snowLine + 70, height)
    * (1 - rock * 0.55)
    * (1 - smoothstep(0.46, 0.82, slope));
  const grass = Math.max(0, 1 - sand - rock - snow);
  const total = grass + rock + sand + snow || 1;
  return { grass: grass / total, rock: rock / total, sand: sand / total, snow: snow / total };
}

/**
 * The height of the airfield's surface: the flat shelf, so the runway and the
 * apron sit on ground the mesh also shows as flat.
 */
export function airfieldHeightAt(x, z, seed = ISLAND_SEED) {
  const flat = shelfBlend(x, z);
  return heightAt(x, z, seed) * (1 - flat) + WORLD.airfieldHeight * flat;
}

/** True when the point lies on the airfield's level shelf. */
export function onAirfield(x, z) {
  return shelfBlend(x, z) > 0;
}

/**
 * A mask of the shoreline, baked once on the CPU: how close the sea is to each
 * point of a square around the island. The water's shader reads it to draw
 * the foam line where the waves break on the sand, so the coast reads as a
 * coast and not as a hard edge between two flat colours.
 *
 * The mask is a single-channel texture: red is the shore's proximity, from 0
 * far out at sea to 1 on the sand.
 */
export function createShorelineMask(size = 256, reach = 4800) {
  const data = new Uint8Array(size * size);
  const span = reach * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const worldX = (x / (size - 1) - 0.5) * span;
      const worldZ = (y / (size - 1) - 0.5) * span;
      const height = heightAt(worldX, worldZ);
      // A band of foam: it is thickest right at the water's edge and fades
      // both inland and out to sea.
      const inland = 1 - smoothstep(0, 15, height);
      const offshore = 1 - smoothstep(-3, -20, height);
      const value = Math.max(inland, offshore);
      data[y * size + x] = Math.round(Math.min(1, Math.max(0, value)) * 255);
    }
  }
  return { data, size, span, reach };
}
