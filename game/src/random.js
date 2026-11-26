// A small, repeatable random-number kit: the world's seed decides every rock, tree
// and cloud, so the same seed always gives the same island and the same screenshots.

/** A fast, repeatable 32-bit generator (Mulberry32). Returns a function giving 0..1. */
export function createRandom(seed) {
  let state = (seed >>> 0) || 1;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A repeatable hash of two integers to a number in 0..1. */
export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The smoothstep curve, from 0 to 1 as x goes from edge0 to edge1. */
export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The linear interpolation between two numbers. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Value noise in 2D: smooth, repeatable, in 0..1. */
export function valueNoise2(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(n00, n10, ux), lerp(n01, n11, ux), uy);
}

/** Fractal noise in 2D: value noise summed over octaves, normalised to 0..1. */
export function fbm2(x, y, seed, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * valueNoise2(x * frequency, y * frequency, seed + octave * 1013);
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / total;
}

/** Ridged noise in 2D: the sharp crests of a mountain range, in 0..1. */
export function ridged2(x, y, seed, octaves = 4) {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const n = 1 - Math.abs(valueNoise2(x * frequency, y * frequency, seed + octave * 733) * 2 - 1);
    sum += amplitude * n * n;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return sum / total;
}
