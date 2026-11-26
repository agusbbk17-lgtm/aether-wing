// Every tuning number of Aether Wing in one place: the world's shape, the aircraft's
// performance, the physics constants, the colours of the world and the quality presets.
// Nothing else in the game hard-codes a number that a designer would want to change.

/** The island, the sea around it and the airfield cut into its middle. */
export const WORLD = {
  /** The terrain patch, in metres, centred on the origin. */
  terrainSize: 9000,
  /** Its resolution: segments per side, so vertices = (segments + 1)^2. */
  terrainSegments: 224,
  /** The airport's ground height above the sea, in metres. */
  airfieldHeight: 7,
  /** The airfield's flat disc: level inside `airfieldInner`, blending out to here. */
  airfieldInner: 420,
  airfieldOuter: 1150,
  /** The runway: along Z, centred on the origin. */
  runwayLength: 1500,
  runwayWidth: 48,
  /** The sea plane is far larger than the terrain, so the horizon is water, not an edge. */
  seaSize: 60000,
  /** Where the sun stands. */
  sunElevation: 0.62,
  sunAzimuth: 2.35,
  /** Exponential haze that hides the edge of the world. */
  fogDensity: 0.00019,
  /** Height above which the peaks keep their snow. */
  snowLine: 235,
  /** Height above which the shore turns to sand. */
  sandLine: 9,
};

/** The aeroplane: a single-engine, low-wing taildragger of about 190 knots. */
export const AIRCRAFT = {
  /** Wing area, in square metres, used by the lift and drag sums. */
  wingArea: 16.2,
  /** Wing span, in metres: the roll authority and the camera framing depend on it. */
  span: 10.4,
  /** Maximum thrust, in newtons. */
  thrust: 5100,
  /** The speed the trim is set for, in metres per second. */
  cruiseSpeed: 52,
  /** Top speed in level flight, in metres per second. */
  maxSpeed: 96,
  /** The stall angle of attack, in radians. */
  stallAlpha: 0.28,
  /** Lift slope, per radian. */
  liftSlope: 5.1,
  /** Drag coefficients. */
  dragBase: 0.031,
  dragInduced: 0.055,
  /** How hard the elevator, ailerons and rudder work. */
  pitchPower: 3.1,
  rollPower: 4.4,
  yawPower: 1.35,
  /** How fast the surfaces settle, per second. */
  damping: 3.1,
  /** The aeroplane's mass, in kilograms. */
  mass: 1150,
  /** Fuel: litres in the tanks, litres burnt per second at full throttle. */
  fuelCapacity: 120,
  fuelBurn: 0.62,
  /** Ground handling. */
  groundFriction: 0.72,
  wheelBrake: 1.9,
};

/** The physics step and the constants the flight model needs. */
export const PHYSICS = {
  step: 1 / 120,
  gravity: 9.81,
  /** Air density, in kilograms per cubic metre, at sea level. */
  airDensity: 1.225,
  /** The camera's smoothing, per second. */
  cameraLag: 6.5,
};

/** The colours of the world. */
export const PALETTE = {
  skyZenith: 0x2f6fb0,
  skyHorizon: 0xbcd4e6,
  haze: 0xc9d8e2,
  sun: 0xfff3d4,
  sunLight: 0xfff0d8,
  groundBounce: 0x6b7a4e,
  fog: 0xb9cede,
  seaDeep: 0x123b52,
  seaShallow: 0x2e7f8c,
  foam: 0xe8f4f6,
  grass: 0x6d8a44,
  rock: 0x7b7468,
  sand: 0xcbb287,
  snow: 0xeef2f4,
  asphalt: 0x3a3d42,
  marking: 0xe9ecef,
  hull: 0xdfe3e7,
  hullShade: 0xa9b2b9,
  trim: 0xc2452f,
  canopy: 0x2c3b46,
  instrument: 0x0e1418,
  instrumentGlow: 0xffb257,
  hudGreen: 0x9dff9a,
  hudAmber: 0xffc857,
  hudRed: 0xff6b5c,
};

/** The HUD's own layout, in CSS pixels of a 1280x720 design. */
export const HUD = {
  width: 1280,
  height: 720,
  gaugeRadius: 58,
  tapeWidth: 86,
  minimapSize: 208,
  font: '"DejaVu Sans Mono", "Courier New", ui-monospace, monospace',
};

/**
 * The quality presets. "low" keeps a laptop at 60 frames a second, "ultra" is for
 * a machine with a discrete GPU; the game picks one at boot and the player can
 * change it at any time from the menu.
 */
export const QUALITY = {
  low: {
    label: 'Low',
    pixelRatio: 1,
    shadowMapSize: 1024,
    shadows: true,
    bloom: false,
    trees: 900,
    rocks: 220,
    clouds: 42,
    terrainSegments: 144,
    waterSegments: 96,
    trailSegments: 28,
    anisotropy: 2,
    treeDistance: 3200,
  },
  high: {
    label: 'High',
    pixelRatio: 1.5,
    shadowMapSize: 2048,
    shadows: true,
    bloom: true,
    trees: 2200,
    rocks: 420,
    clouds: 90,
    terrainSegments: 224,
    waterSegments: 160,
    trailSegments: 48,
    anisotropy: 8,
    treeDistance: 4600,
  },
  ultra: {
    label: 'Ultra',
    pixelRatio: 2,
    shadowMapSize: 4096,
    shadows: true,
    bloom: true,
    trees: 4200,
    rocks: 700,
    clouds: 150,
    terrainSegments: 288,
    waterSegments: 220,
    trailSegments: 64,
    anisotropy: 16,
    treeDistance: 5600,
  },
};

/** The name of the game, its world and its aeroplane: the entry's own names. */
export const GAME = {
  title: 'AETHER WING',
  subtitle: 'Island Air Racing',
  aircraft: 'Aerodyne Kestrel',
  world: 'Sable Reach',
  airfield: 'Reach Field',
};
