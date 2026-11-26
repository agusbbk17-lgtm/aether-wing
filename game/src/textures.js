// Every texture in Aether Wing is made here, in code, on a canvas: the ground's four
// splat layers with their normal and roughness maps, the sea's ripples, the asphalt
// and its markings, the aircraft's paint with its panel lines and rivets, the trees,
// the clouds and the instruments. Nothing is loaded from a file or the network.
import * as THREE from '../vendor/three.module.min.js';
import { createRandom, hash2, lerp, smoothstep } from './random.js';

/** A canvas of the given size, with its 2D context. */
function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, context };
}

/** A THREE texture from a canvas, with the usual wrapping and colour space. */
function toTexture(canvas, { srgb = true, repeat = 1, aniso = 4 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = aniso;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A normal map built from a height field: the gradient of the height becomes the
 * normal, so a painted height field and a lit surface agree with each other.
 */
function normalFromHeight(height, size, strength) {
  const { canvas, context } = makeCanvas(size);
  const image = context.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = height[y * size + ((x - 1 + size) % size)];
      const right = height[y * size + ((x + 1) % size)];
      const up = height[((y - 1 + size) % size) * size + x];
      const down = height[((y + 1) % size) * size + x];
      const nx = (left - right) * strength;
      const ny = (up - down) * strength;
      const nz = 1;
      const length = Math.hypot(nx, ny, nz);
      const index = (y * size + x) * 4;
      data[index] = ((nx / length) * 0.5 + 0.5) * 255;
      data[index + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      data[index + 2] = ((nz / length) * 0.5 + 0.5) * 255;
      data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/** A greyscale canvas from a height field: used for roughness and metalness maps. */
function greyFromHeight(height, size) {
  const { canvas, context } = makeCanvas(size);
  const image = context.createImageData(size, size);
  const data = image.data;
  for (let index = 0; index < height.length; index += 1) {
    const value = Math.max(0, Math.min(255, height[index] * 255)) | 0;
    const at = index * 4;
    data[at] = value;
    data[at + 1] = value;
    data[at + 2] = value;
    data[at + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Fills a canvas with speckled noise: the base of every ground layer.
 * The speckles come from a repeatable hash, so the texture is the same every boot.
 */
function speckle(context, size, seed, { count, minSize, maxSize, colors, alpha }) {
  const random = createRandom(seed);
  for (let index = 0; index < count; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = lerp(minSize, maxSize, random() * random());
    const color = colors[(random() * colors.length) | 0];
    context.globalAlpha = alpha * lerp(0.5, 1, random());
    context.fillStyle = color;
    context.beginPath();
    context.ellipse(x, y, radius, radius * lerp(0.6, 1.4, random()), random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

/**
 * The grass layer: green blades over a darker soil, with clumps and dry patches.
 */
function grassLayer(size, seed) {
  const { canvas, context } = makeCanvas(size);
  context.fillStyle = '#4d6630';
  context.fillRect(0, 0, size, size);
  speckle(context, size, seed, {
    count: 900,
    minSize: 2,
    maxSize: 9,
    colors: ['#5f7a3a', '#43592a', '#6d8a44', '#7d9550'],
    alpha: 0.55,
  });
  // Dry, sun-bleached patches.
  speckle(context, size, seed + 31, {
    count: 90,
    minSize: 12,
    maxSize: 40,
    colors: ['#8a8f4a', '#96924f'],
    alpha: 0.28,
  });
  // Blades: short strokes that give the layer its grain at close range.
  const random = createRandom(seed + 77);
  for (let index = 0; index < 2600; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = lerp(3, 9, random());
    context.strokeStyle = random() < 0.5 ? 'rgba(120,150,70,0.55)' : 'rgba(52,72,32,0.5)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + lerp(-2, 2, random()), y - length);
    context.stroke();
  }
  return canvas;
}

/**
 * The rock layer: cracked grey stone with lichen and darker fissures.
 */
function rockLayer(size, seed) {
  const { canvas, context } = makeCanvas(size);
  context.fillStyle = '#6f6a60';
  context.fillRect(0, 0, size, size);
  speckle(context, size, seed, {
    count: 700,
    minSize: 3,
    maxSize: 16,
    colors: ['#7b7468', '#655f56', '#8a8377', '#575249'],
    alpha: 0.5,
  });
  // Fissures: branching dark lines.
  const random = createRandom(seed + 13);
  context.lineCap = 'round';
  for (let index = 0; index < 130; index += 1) {
    let x = random() * size;
    let y = random() * size;
    context.strokeStyle = `rgba(38,34,30,${lerp(0.18, 0.42, random())})`;
    context.lineWidth = lerp(0.8, 2.4, random());
    context.beginPath();
    context.moveTo(x, y);
    const steps = 6 + ((random() * 8) | 0);
    for (let step = 0; step < steps; step += 1) {
      x += lerp(-26, 26, random());
      y += lerp(-26, 26, random());
      context.lineTo(x, y);
    }
    context.stroke();
  }
  // Lichen.
  speckle(context, size, seed + 91, {
    count: 140,
    minSize: 2,
    maxSize: 7,
    colors: ['#8d9a63', '#a3a877'],
    alpha: 0.3,
  });
  return canvas;
}

/**
 * The sand layer: fine grains, ripples and a few pebbles.
 */
function sandLayer(size, seed) {
  const { canvas, context } = makeCanvas(size);
  context.fillStyle = '#cbb287';
  context.fillRect(0, 0, size, size);
  speckle(context, size, seed, {
    count: 800,
    minSize: 1,
    maxSize: 5,
    colors: ['#d6bf95', '#bfa477', '#e0cda8'],
    alpha: 0.45,
  });
  // Wind ripples.
  const random = createRandom(seed + 5);
  for (let index = 0; index < 60; index += 1) {
    const y = random() * size;
    context.strokeStyle = `rgba(160,138,100,${lerp(0.1, 0.26, random())})`;
    context.lineWidth = lerp(1, 3, random());
    context.beginPath();
    for (let x = 0; x <= size; x += 8) {
      const wobble = Math.sin((x / size) * Math.PI * 4 + index) * 4;
      if (x === 0) context.moveTo(x, y + wobble);
      else context.lineTo(x, y + wobble);
    }
    context.stroke();
  }
  // Pebbles.
  speckle(context, size, seed + 17, {
    count: 60,
    minSize: 1,
    maxSize: 3,
    colors: ['#8d8375', '#6f685c'],
    alpha: 0.5,
  });
  return canvas;
}

/**
 * The snow layer: cold white with blue shadows and a few exposed stones.
 */
function snowLayer(size, seed) {
  const { canvas, context } = makeCanvas(size);
  context.fillStyle = '#eef2f4';
  context.fillRect(0, 0, size, size);
  speckle(context, size, seed, {
    count: 500,
    minSize: 4,
    maxSize: 18,
    colors: ['#ffffff', '#e2e9ef', '#d3dee8'],
    alpha: 0.4,
  });
  speckle(context, size, seed + 61, {
    count: 40,
    minSize: 3,
    maxSize: 9,
    colors: ['#8a8377'],
    alpha: 0.3,
  });
  // Drift lines.
  const random = createRandom(seed + 3);
  for (let index = 0; index < 40; index += 1) {
    const y = random() * size;
    context.strokeStyle = `rgba(186,204,220,${lerp(0.15, 0.35, random())})`;
    context.lineWidth = lerp(2, 6, random());
    context.beginPath();
    for (let x = 0; x <= size; x += 16) {
      const wobble = Math.sin((x / size) * Math.PI * 2 + index * 1.7) * 6;
      if (x === 0) context.moveTo(x, y + wobble);
      else context.lineTo(x, y + wobble);
    }
    context.stroke();
  }
  return canvas;
}

/**
 * A tileable height field for a ground layer, matching the look of its colour map.
 * The height feeds the normal map, so the ground catches the light like the picture.
 */
function groundHeight(size, seed, kind) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * 8;
      const v = (y / size) * 8;
      let value = 0.5;
      if (kind === 'grass') {
        value = 0.5 + (hash2(x, y, seed) - 0.5) * 0.55 + (hash2(x * 3, y * 3, seed + 5) - 0.5) * 0.25;
      } else if (kind === 'rock') {
        value = 0.5 + (hash2(x, y, seed) - 0.5) * 0.9;
      } else if (kind === 'sand') {
        value = 0.5 + Math.sin((y / size) * Math.PI * 22 + Math.sin((x / size) * Math.PI * 4) * 2) * 0.12;
      } else {
        value = 0.5 + (hash2(x, y, seed) - 0.5) * 0.4;
      }
      height[y * size + x] = value;
    }
  }
  // Blur it a little so the normal map has no hard single-pixel edges.
  const blurred = new Float32Array(height.length);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          sum += height[((y + dy + size) % size) * size + ((x + dx + size) % size)];
        }
      }
      blurred[y * size + x] = sum / 9;
    }
  }
  return blurred;
}

/**
 * The four ground layers, each with its colour, normal and roughness maps.
 */
export function createGroundTextures(quality) {
  const size = quality.textureSize ?? 512;
  const aniso = quality.anisotropy;
  const kinds = [
    { kind: 'grass', key: 'grass' },
    { kind: 'rock', key: 'rock' },
    { kind: 'sand', key: 'sand' },
    { kind: 'snow', key: 'snow' },
  ];
  const maps = {};
  kinds.forEach((entry, index) => {
    const seed = 1000 + index * 977;
    const colour = entry.kind === 'grass' ? grassLayer(size, seed)
      : entry.kind === 'rock' ? rockLayer(size, seed)
        : entry.kind === 'sand' ? sandLayer(size, seed)
          : snowLayer(size, seed);
    const height = groundHeight(size, seed, entry.kind);
    maps[entry.key] = {
      map: toTexture(colour, { srgb: true, aniso }),
      normalMap: toTexture(normalFromHeight(height, size, entry.kind === 'rock' ? 5.5 : 2.4), { srgb: false, aniso }),
      roughnessMap: toTexture(greyFromHeight(height, size), { srgb: false, aniso }),
    };
  });
  return maps;
}

/**
 * The sea's surface: a tiling map of ripples and wavelets, used as its normal map.
 */
export function createWaterTextures(quality) {
  const size = quality.textureSize ?? 512;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const wave =
        Math.sin(u * 4 + Math.cos(v * 3) * 1.4) * 0.24 +
        Math.sin(v * 7 - Math.cos(u * 2) * 1.1) * 0.16 +
        Math.sin((u + v) * 11) * 0.09 +
        (hash2(x, y, 4242) - 0.5) * 0.22;
      height[y * size + x] = 0.5 + wave * 0.4;
    }
  }
  const normal = normalFromHeight(height, size, 3.2);
  return {
    normalMap: toTexture(normal, { srgb: false, aniso: quality.anisotropy }),
    roughnessMap: toTexture(greyFromHeight(height, size), { srgb: false, aniso: quality.anisotropy }),
  };
}

/**
 * The runway's asphalt: coarse aggregate, patched seams and oil staining.
 */
export function createAsphaltTexture(quality) {
  const size = quality.textureSize ?? 512;
  const { canvas, context } = makeCanvas(size);
  context.fillStyle = '#3a3d42';
  context.fillRect(0, 0, size, size);
  speckle(context, size, 8080, {
    count: 2600,
    minSize: 1,
    maxSize: 3,
    colors: ['#4a4e54', '#33363b', '#54585e', '#2c2f33'],
    alpha: 0.5,
  });
  // Repair patches.
  const random = createRandom(3131);
  for (let index = 0; index < 14; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const w = lerp(30, 120, random());
    const h = lerp(20, 90, random());
    context.fillStyle = `rgba(${28 + random() * 22 | 0},${30 + random() * 20 | 0},${34 + random() * 20 | 0},0.45)`;
    context.fillRect(x, y, w, h);
  }
  // Cracks.
  for (let index = 0; index < 40; index += 1) {
    let x = random() * size;
    let y = random() * size;
    context.strokeStyle = 'rgba(18,19,21,0.55)';
    context.lineWidth = lerp(0.6, 1.6, random());
    context.beginPath();
    context.moveTo(x, y);
    for (let step = 0; step < 8; step += 1) {
      x += lerp(-22, 22, random());
      y += lerp(-22, 22, random());
      context.lineTo(x, y);
    }
    context.stroke();
  }
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      height[y * size + x] = 0.5 + (hash2(x, y, 8080) - 0.5) * 0.8;
    }
  }
  return {
    map: toTexture(canvas, { srgb: true, aniso: quality.anisotropy }),
    normalMap: toTexture(normalFromHeight(height, size, 1.4), { srgb: false, aniso: quality.anisotropy }),
    roughnessMap: toTexture(greyFromHeight(height, size), { srgb: false, aniso: quality.anisotropy }),
  };
}

/**
 * The aircraft's paint: bare metal under a light coat, with panel lines, rivet
 * rows, paint wear along the leading edges and dirt streaks behind them.
 */
export function createAircraftTextures(quality) {
  const size = quality.textureSize ?? 512;
  const { canvas, context } = makeCanvas(size);
  context.fillStyle = '#dfe3e7';
  context.fillRect(0, 0, size, size);

  // Mottled paint: the aluminium under the coat shows through in patches.
  speckle(context, size, 5150, {
    count: 260,
    minSize: 6,
    maxSize: 34,
    colors: ['#e9edf1', '#cfd5da', '#c3cad0'],
    alpha: 0.32,
  });

  // Panel lines: a grid of riveted seams.
  const random = createRandom(6060);
  context.lineCap = 'round';
  const panelStep = size / 8;
  for (let index = 0; index <= 8; index += 1) {
    const at = index * panelStep;
    context.strokeStyle = 'rgba(120,128,136,0.55)';
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(at, 0);
    context.lineTo(at, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, at);
    context.lineTo(size, at);
    context.stroke();
    // Rivets along each seam.
    for (let step = 6; step < size; step += 9) {
      context.fillStyle = 'rgba(105,113,121,0.6)';
      context.beginPath();
      context.arc(at, step, 1.5, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(step, at, 1.5, 0, Math.PI * 2);
      context.fill();
    }
  }

  // Dirt streaks: thin dark runs that drip aft of the seams.
  for (let index = 0; index < 46; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const length = lerp(14, 90, random());
    const gradient = context.createLinearGradient(x, y, x, y + length);
    gradient.addColorStop(0, 'rgba(96,88,74,0.42)');
    gradient.addColorStop(1, 'rgba(96,88,74,0)');
    context.fillStyle = gradient;
    context.fillRect(x, y, lerp(1.5, 5, random()), length);
  }

  // Paint wear: scuffs where the coat has rubbed through.
  for (let index = 0; index < 70; index += 1) {
    const x = random() * size;
    const y = random() * size;
    context.fillStyle = `rgba(150,158,166,${lerp(0.15, 0.4, random())})`;
    context.beginPath();
    context.ellipse(x, y, lerp(2, 9, random()), lerp(1, 4, random()), random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }

  // The height field: the seams sit lower than the skin, the rivets a little higher.
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const seam = (x % panelStep < 1.6 || y % panelStep < 1.6) ? -0.22 : 0;
      const rivet = (Math.abs((x % panelStep) - 6) < 1.2 && (y % 9) < 2) ? 0.16 : 0;
      height[y * size + x] = 0.5 + seam + rivet + (hash2(x, y, 5150) - 0.5) * 0.08;
    }
  }

  return {
    map: toTexture(canvas, { srgb: true, aniso: quality.anisotropy }),
    normalMap: toTexture(normalFromHeight(height, size, 1.9), { srgb: false, aniso: quality.anisotropy }),
    roughnessMap: toTexture(greyFromHeight(height, size), { srgb: false, aniso: quality.anisotropy }),
  };
}

/**
 * A tree's canopy: a mottled mass of leaves with light and shadow inside it.
 */
export function createCanopyTexture(quality) {
  const size = 256;
  const { canvas, context } = makeCanvas(size);
  context.fillStyle = '#3f5c2c';
  context.fillRect(0, 0, size, size);
  speckle(context, size, 9090, {
    count: 1400,
    minSize: 2,
    maxSize: 8,
    colors: ['#4e7136', '#37521f', '#618a44', '#7ba055'],
    alpha: 0.7,
  });
  const random = createRandom(313);
  for (let index = 0; index < 500; index += 1) {
    const x = random() * size;
    const y = random() * size;
    context.strokeStyle = random() < 0.5 ? 'rgba(96,132,68,0.5)' : 'rgba(28,44,18,0.45)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + lerp(-4, 4, random()), y + lerp(-4, 4, random()));
    context.stroke();
  }
  return { map: toTexture(canvas, { srgb: true, aniso: quality.anisotropy }) };
}

/**
 * A cloud's billboard: a soft puff with a lit top and a shadowed underside.
 */
export function createCloudTexture() {
  const size = 256;
  const { canvas, context } = makeCanvas(size);
  const random = createRandom(7171);
  context.clearRect(0, 0, size, size);
  for (let index = 0; index < 60; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.pow(random(), 0.6) * size * 0.3;
    const x = size / 2 + Math.cos(angle) * distance;
    const y = size / 2 + Math.sin(angle) * distance * 0.55;
    const radius = lerp(size * 0.08, size * 0.2, random());
    const gradient = context.createRadialGradient(x, y - radius * 0.3, radius * 0.1, x, y, radius);
    gradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.55, 'rgba(238,244,250,0.7)');
    gradient.addColorStop(1, 'rgba(198,214,230,0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  // Feather the edge so the billboard has no hard square.
  const fade = context.createRadialGradient(size / 2, size / 2, size * 0.22, size / 2, size / 2, size * 0.5);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  context.globalCompositeOperation = 'destination-out';
  context.fillStyle = fade;
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'source-over';
  return { map: toTexture(canvas, { srgb: true }) };
}

/**
 * The sky: a gradient dome's own texture, from a warm horizon to a deep zenith,
 * with a sun's glow painted into it.
 */
export function createSkyTexture(quality, palette, sunDirection) {
  const width = 1024;
  const height = 512;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#1f5fa8');
  gradient.addColorStop(0.34, '#4d8fc8');
  gradient.addColorStop(0.62, '#9fc6de');
  gradient.addColorStop(0.82, '#d7e5ee');
  gradient.addColorStop(1, '#c8d6dd');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  // The sun's glow, painted where the sun stands.
  const sunX = ((Math.atan2(sunDirection.x, sunDirection.z) / (Math.PI * 2)) + 0.5) * width;
  const sunY = height * (0.5 - Math.asin(sunDirection.y) / Math.PI);
  const glow = context.createRadialGradient(sunX, sunY, 4, sunX, sunY, width * 0.26);
  glow.addColorStop(0, 'rgba(255,252,238,0.98)');
  glow.addColorStop(0.08, 'rgba(255,244,214,0.85)');
  glow.addColorStop(0.3, 'rgba(255,232,190,0.28)');
  glow.addColorStop(1, 'rgba(255,230,190,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  // Thin cirrus, so the sky is not a plain wash.
  const random = createRandom(4242);
  for (let index = 0; index < 90; index += 1) {
    const y = lerp(height * 0.12, height * 0.68, Math.pow(random(), 0.7));
    const x = random() * width;
    const w = lerp(60, 320, random());
    const h = lerp(3, 14, random());
    context.fillStyle = `rgba(255,255,255,${lerp(0.05, 0.22, random())})`;
    context.beginPath();
    context.ellipse(x, y, w, h, 0, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A tree's trunk and bark, and a rock's surface.
 */
export function createBarkTexture(quality) {
  const size = 256;
  const { canvas, context } = makeCanvas(size);
  context.fillStyle = '#4a3a2b';
  context.fillRect(0, 0, size, size);
  const random = createRandom(2121);
  for (let index = 0; index < 260; index += 1) {
    const x = random() * size;
    context.strokeStyle = `rgba(${30 + random() * 40 | 0},${22 + random() * 30 | 0},${16 + random() * 22 | 0},${lerp(0.3, 0.8, random())})`;
    context.lineWidth = lerp(1, 4, random());
    context.beginPath();
    context.moveTo(x, 0);
    for (let y = 0; y <= size; y += 16) {
      context.lineTo(x + Math.sin(y * 0.06 + index) * 3, y);
    }
    context.stroke();
  }
  return { map: toTexture(canvas, { srgb: true, aniso: quality.anisotropy }) };
}
