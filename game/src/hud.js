// The HUD, drawn on its own 2D canvas over the 3D picture: an airspeed tape and an
// altitude tape on the edges, an attitude ball at the centre, a compass ribbon along
// the top, the mission's clock and the next ring's guidance at the upper left, a
// minimap at the upper right, throttle and fuel along the bottom left, and a
// vertical-speed dial with the flap and gear state at the bottom right.
//
// The layout is fixed to a 1280x720 design and scaled by `scale`, so every panel has
// its own reserved rectangle in BOX: nothing here can be drawn on top of anything
// else at any window size. The instruments are drawn as flown instruments: they move
// with lag, they have bezels and glass, they are lit from within, and the tapes carry
// their trend vectors.
import { HUD } from './config.js';
import { heightAt } from './terrain.js';

const COLOURS = {
  green: '#9dff9a',
  amber: '#ffc857',
  red: '#ff6b5c',
  cyan: '#8fe9ff',
  white: '#eef4f8',
  dim: 'rgba(238,244,248,0.55)',
  panel: 'rgba(9,16,22,0.62)',
  plate: 'rgba(8,14,20,0.92)',
  edge: 'rgba(160,200,225,0.35)',
};

/**
 * The reserved rectangle of every panel, in the 1280x720 design. `right` and `cx`
 * are resolved against the canvas, so a panel keeps its distance from the edge it
 * belongs to however wide the window is.
 */
const BOX = {
  mission: { x: 26, y: 24, w: 300, h: 100 },
  compass: { w: 420, h: 32, y: 36 },
  minimap: { size: 200, right: 26, y: 24 },
  speed: { x: 44, y: 232, w: 84, h: 300 },
  altitude: { right: 44, y: 232, w: 84, h: 300 },
  ball: { cy: 372, r: 68 },
  bars: { x: 44, y: 600, w: 208 },
  vsi: { right: 96, cy: 630, r: 40 },
  rig: { right: 168, y: 596, w: 150, h: 68 },
  warn: { cy: 150 },
};

/** The airspeed's coloured arc, in knots: the ranges a pilot reads at a glance. */
const SPEED_BANDS = [
  { from: 0, to: 220, colour: 'rgba(238,244,248,0.30)', width: 3 },
  { from: 55, to: 168, colour: 'rgba(157,255,154,0.75)', width: 7 },
  { from: 168, to: 196, colour: 'rgba(255,200,87,0.8)', width: 5 },
  { from: 196, to: 220, colour: 'rgba(255,107,92,0.85)', width: 5 },
];

/** The tape's ranges, so the numbers can be culled to the panel that holds them. */
const SPEED_MAX = 220;
const ALT_MAX = 1400;

/** Draws a stroked arc. */
function arc(context, x, y, radius, from, to, width, colour) {
  context.beginPath();
  context.arc(x, y, radius, from, to);
  context.strokeStyle = colour;
  context.lineWidth = width;
  context.stroke();
}

/** Writes a label in the HUD's own font. */
function label(context, text, x, y, size = 13, colour = COLOURS.dim, align = 'left') {
  context.font = `${size}px ${HUD.font}`;
  context.fillStyle = colour;
  context.textAlign = align;
  context.textBaseline = 'middle';
  context.fillText(text, x, y);
}

/** A rounded panel with the HUD's own glass edge, filled and outlined in one call. */
function panel(context, x, y, w, h, radius = 8, fill = COLOURS.panel, stroke = COLOURS.edge) {
  context.beginPath();
  context.roundRect(x, y, w, h, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1.3;
    context.stroke();
  }
}

/** The dark window a digital readout sits in, with its own coloured border. */
function plate(context, x, y, w, h, border) {
  context.fillStyle = COLOURS.plate;
  context.fillRect(x, y, w, h);
  if (border) {
    context.strokeStyle = border;
    context.lineWidth = 1.6;
    context.strokeRect(x, y, w, h);
  }
}

/** A vertical bar of colour between two values on a tape, in tape pixels. */
function band(context, x, y, height, top, bottom, from, to, colour, width) {
  const span = top - bottom;
  const yFrom = y + height - ((from - bottom) / span) * height;
  const yTo = y + height - ((to - bottom) / span) * height;
  context.fillStyle = colour;
  context.fillRect(x, Math.min(yFrom, yTo), width, Math.abs(yTo - yFrom));
}

export function createHud(canvas) {
  const context = canvas.getContext('2d');
  const state = {
    /** The smoothed airspeed, in knots, so the needle does not jump. */
    speed: 0,
    /** The smoothed altitude, in metres. */
    altitude: 0,
    /** The smoothed height above the ground, in metres. */
    agl: 0,
    /** The smoothed heading, in degrees. */
    heading: 0,
    /** The smoothed rate of climb, in metres per second. */
    climb: 0,
    /** The smoothed fuel, in litres. */
    fuel: 120,
    /** The smoothed throttle, 0..1. */
    throttle: 0,
    /** The frame counter, for the frame-rate readout. */
    frames: 0,
    fps: 60,
    fpsTimer: 0,
  };

  return {
    state,

    /**
     * Jump the smoothing straight to the truth. A still picture is one frame, so
     * without this the needles would still be lying at the values the HUD was built
     * with, and the photograph would show an aeroplane it is not flying.
     */
    snap(flight) {
      state.speed = flight.knots;
      state.altitude = flight.state.position.y;
      state.agl = flight.heightAboveGround;
      state.fuel = flight.state.fuel;
      state.throttle = flight.state.throttle;
      state.climb = flight.state.velocity.y;
      let heading = (flight.state.heading * 180) / Math.PI;
      heading = ((heading % 360) + 360) % 360;
      state.heading = heading;
    },

    /**
     * Paints the HUD for this frame.
     * @param {object} flight the flight model
     * @param {object} mission the mission's state
     * @param {object} world the world, for the minimap
     * @param {number} delta the frame's length
     */
    draw(flight, mission, world, delta, extra) {
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      context.lineWidth = 1;

      // The smoothed values.
      state.speed += (flight.knots - state.speed) * Math.min(1, delta * 8);
      state.altitude += (flight.state.position.y - state.altitude) * Math.min(1, delta * 8);
      state.agl += (flight.heightAboveGround - state.agl) * Math.min(1, delta * 8);
      state.fuel += (flight.state.fuel - state.fuel) * Math.min(1, delta * 6);
      state.throttle += (flight.state.throttle - state.throttle) * Math.min(1, delta * 8);
      let heading = (flight.state.heading * 180) / Math.PI;
      heading = ((heading % 360) + 360) % 360;
      let headingDelta = heading - state.heading;
      if (headingDelta > 180) headingDelta -= 360;
      if (headingDelta < -180) headingDelta += 360;
      state.heading += headingDelta * Math.min(1, delta * 8);
      state.climb += (flight.state.velocity.y - state.climb) * Math.min(1, delta * 5);

      state.fpsTimer += delta;
      if (state.fpsTimer > 0.5) {
        state.fps = Math.max(1, Math.round(state.frames / state.fpsTimer));
        state.frames = 0;
        state.fpsTimer = 0;
      }
      state.frames += 1;

      this.drawTapes();
      this.drawBall(flight);
      this.drawCompass();
      this.drawMinimap(flight, world);
      this.drawWarnings(flight);
      this.drawMission(mission);
      this.drawBars();
      this.drawVsi();
      this.drawRig(flight);
      this.drawCorner(extra);
    },

    /**
     * The airspeed tape on the left and the altitude tape on the right, each in its
     * own reserved column: a band of colour for the certified ranges, a tick every
     * ten knots (fifty metres), a boxed digital readout at the centre line and a
     * trend vector that shows where the value is heading in ten seconds.
     */
    drawTapes() {
      const width = canvas.width;
      const scale = width / HUD.width;

      const drawTape = (box, value, unit, min, max, step, major, bands, accent, sub, subLabel) => {
        const x = box.x !== undefined ? box.x * scale : width - box.right * scale - box.w * scale;
        const y = box.y * scale;
        const w = box.w * scale;
        const h = box.h * scale;
        const span = max - min;
        const at = (v) => y + h - ((v - min) / span) * h;
        const centre = y + h / 2;

        panel(context, x, y, w, h, 6 * scale);

        // The certified ranges, in a strip down the tape's inner edge.
        const stripW = 5 * scale;
        const stripX = box.x !== undefined ? x + w - stripW : x;
        for (const b of bands) {
          band(context, stripX, y, h, max, min, b.from, b.to, b.colour, stripW);
        }

        // The ticks and their numbers, kept inside the panel.
        context.save();
        context.beginPath();
        context.rect(x, y - 1, w, h + 2);
        context.clip();
        for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
          const ty = at(v);
          if (ty < y - 2 || ty > y + h + 2) continue;
          const isMajor = v % major === 0;
          context.strokeStyle = isMajor ? COLOURS.white : COLOURS.dim;
          context.lineWidth = 1.2 * scale;
          const tickLen = (isMajor ? 11 : 6) * scale;
          const edge = box.x !== undefined ? x + w - stripW : x + stripW;
          context.beginPath();
          context.moveTo(edge, ty);
          context.lineTo(edge - (box.x !== undefined ? tickLen : -tickLen), ty);
          context.stroke();
          if (isMajor) {
            const tx = box.x !== undefined ? edge - tickLen - 4 * scale : edge + tickLen + 4 * scale;
            label(context, String(v), tx, ty, 11 * scale, COLOURS.dim,
              box.x !== undefined ? 'right' : 'left');
          }
        }
        context.restore();

        // The centre line the readout is taken against.
        context.strokeStyle = accent;
        context.lineWidth = 1.4 * scale;
        context.beginPath();
        context.moveTo(x, centre);
        context.lineTo(x + w, centre);
        context.stroke();

        // The boxed digital readout.
        const boxH = 26 * scale;
        plate(context, x - 3 * scale, centre - boxH / 2, w + 6 * scale, boxH, accent);
        label(context, String(Math.round(value)), x + w / 2, centre - 1 * scale, 17 * scale,
          COLOURS.white, 'center');
        label(context, unit, x + w / 2, centre + 9 * scale, 8 * scale, COLOURS.dim, 'center');

        // The trend vector: where the value will be in ten seconds.
        const trend = (sub.trend ?? 0) * 10;
        if (Math.abs(trend) > (major / 12)) {
          const ty = at(value + trend);
          const clamped = Math.max(y + 3 * scale, Math.min(y + h - 3 * scale, ty));
          context.strokeStyle = accent;
          context.lineWidth = 2 * scale;
          context.beginPath();
          context.moveTo(x + (box.x !== undefined ? 2 : w - 2) * scale, clamped);
          context.lineTo(x + (box.x !== undefined ? 2 : w - 2) * scale, centre + (clamped > centre ? 10 : -10) * scale);
          context.stroke();
        }

        // The secondary readout, in its own little plate below the tape.
        const sy = y + h + 14 * scale;
        plate(context, x, sy, w, 20 * scale, null);
        label(context, subLabel, x + 5 * scale, sy + 10 * scale, 8 * scale, COLOURS.dim, 'left');
        label(context, sub, x + w - 5 * scale, sy + 10 * scale, 11 * scale, COLOURS.white, 'right');
      };

      const knots = state.speed;
      drawTape(BOX.speed, knots, 'KT', 0, SPEED_MAX, 10, 20, SPEED_BANDS, COLOURS.amber,
        `${Math.round(knots * 1.852)} GS`, 'GROUND');

      drawTape(BOX.altitude, state.altitude, 'M', 0, ALT_MAX, 50, 100, [
        { from: 0, to: ALT_MAX, colour: 'rgba(238,244,248,0.22)', width: 3 },
        { from: 0, to: 120, colour: 'rgba(255,107,92,0.55)', width: 5 },
      ], COLOURS.cyan, `${Math.round(state.agl)} AGL`, 'TERRAIN');
    },

    /**
     * The attitude ball at the centre of the picture: the horizon and the pitch
     * ladder rolled and translated by the aeroplane, the roll pointer above it, and
     * the aircraft's own reference mark fixed at the centre so the pilot reads the
     * error, not the instrument.
     */
    drawBall(flight) {
      const width = canvas.width;
      const scale = width / HUD.width;
      const cx = width / 2;
      const cy = BOX.ball.cy * scale;
      const r = BOX.ball.r * scale;

      context.save();
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.clip();
      // The ball is glass rather than a plate: its sky and earth are laid over
      // the picture at part strength, so the aeroplane the instrument is read
      // for stays visible through it. Only the graduations are opaque.
      // The backing is fainter still than the tint on it. At half strength the
      // plate and the sky it carries went dark enough to swallow the aeroplane
      // sitting dead centre in the chase view, which is the very thing the
      // instrument is there to frame.
      context.globalAlpha = 0.2;
      context.fillStyle = 'rgba(6,12,18,0.9)';
      context.fillRect(cx - r, cy - r, r * 2, r * 2);
      context.globalAlpha = 0.36;

      const roll = -flight.state.roll;
      context.save();
      context.translate(cx, cy);
      context.rotate(roll);
      context.translate(0, flight.state.pitch * 210 * scale);

      const sky = context.createLinearGradient(0, -r * 2.2, 0, -1);
      sky.addColorStop(0, '#1f5f9e');
      sky.addColorStop(1, '#7fb4d8');
      context.fillStyle = sky;
      context.fillRect(-r * 2.2, -r * 2.2, r * 4.4, r * 2.2);
      const earth = context.createLinearGradient(0, 0, 0, r * 2.2);
      earth.addColorStop(0, '#7d6a3e');
      earth.addColorStop(1, '#3d3320');
      context.fillStyle = earth;
      context.fillRect(-r * 2.2, 0, r * 4.4, r * 2.2);
      context.globalAlpha = 1;

      // The horizon, and the ladder of pitch either side of it.
      context.strokeStyle = 'rgba(255,255,255,0.95)';
      context.lineWidth = 1.8 * scale;
      context.beginPath();
      context.moveTo(-r * 2.2, 0);
      context.lineTo(r * 2.2, 0);
      context.stroke();
      context.font = `${8 * scale}px ${HUD.font}`;
      for (let degrees = -30; degrees <= 30; degrees += 10) {
        if (degrees === 0) continue;
        const y = -degrees * 3.5 * scale;
        const half = degrees % 20 === 0 ? r * 0.44 : r * 0.26;
        const up = degrees > 0;
        context.strokeStyle = 'rgba(255,255,255,0.7)';
        context.lineWidth = 1.2 * scale;
        context.beginPath();
        if (up) {
          context.moveTo(-half, y);
          context.lineTo(half, y);
        } else {
          context.moveTo(-half, y);
          context.lineTo(-half * 0.45, y);
          context.moveTo(half * 0.45, y);
          context.lineTo(half, y);
        }
        context.stroke();
        context.fillStyle = 'rgba(238,244,248,0.7)';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(String(Math.abs(degrees)), half + 9 * scale, y);
        if (up) context.fillText(String(Math.abs(degrees)), -half - 9 * scale, y);
      }
      context.restore();

      // The roll pointer, at the top of the ball, and the scale it reads against.
      context.save();
      context.translate(cx, cy);
      context.rotate(roll);
      context.fillStyle = COLOURS.white;
      context.beginPath();
      context.moveTo(0, -r + 2 * scale);
      context.lineTo(-5 * scale, -r + 11 * scale);
      context.lineTo(5 * scale, -r + 11 * scale);
      context.closePath();
      context.fill();
      context.restore();
      context.strokeStyle = COLOURS.dim;
      context.lineWidth = 1.4 * scale;
      for (const degrees of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
        const a = -Math.PI / 2 + (degrees * Math.PI) / 180;
        const inner = degrees % 30 === 0 ? r - 12 * scale : r - 7 * scale;
        context.beginPath();
        context.moveTo(cx + Math.cos(a) * (r - 2 * scale), cy + Math.sin(a) * (r - 2 * scale));
        context.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        context.stroke();
      }

      // The aircraft's own reference mark: fixed, so the ball's movement is the error.
      context.strokeStyle = COLOURS.amber;
      context.lineWidth = 2.6 * scale;
      context.beginPath();
      context.moveTo(cx - r * 0.5, cy);
      context.lineTo(cx - r * 0.18, cy);
      context.moveTo(cx + r * 0.18, cy);
      context.lineTo(cx + r * 0.5, cy);
      context.moveTo(cx - r * 0.18, cy);
      context.lineTo(cx - r * 0.18, cy + 5 * scale);
      context.moveTo(cx + r * 0.18, cy);
      context.lineTo(cx + r * 0.18, cy + 5 * scale);
      context.stroke();

      // The flight-path vector: where the aeroplane is actually going.
      const alpha = Math.max(-0.35, Math.min(0.35, flight.state.angleOfAttack ?? 0));
      const fx = cx;
      const fy = cy + alpha * 210 * scale;
      if (Math.hypot(fx - cx, fy - cy) < r * 0.92) {
        context.strokeStyle = COLOURS.green;
        context.lineWidth = 1.6 * scale;
        context.beginPath();
        context.arc(fx, fy, 4.5 * scale, 0, Math.PI * 2);
        context.moveTo(fx - 9 * scale, fy);
        context.lineTo(fx - 4.5 * scale, fy);
        context.moveTo(fx + 4.5 * scale, fy);
        context.lineTo(fx + 9 * scale, fy);
        context.moveTo(fx, fy - 6 * scale);
        context.lineTo(fx, fy - 4.5 * scale);
        context.stroke();
      }

      // The glass: a sheen across the top, and the bezel.
      const sheen = context.createLinearGradient(cx - r, cy - r, cx + r * 0.3, cy + r);
      sheen.addColorStop(0, 'rgba(255,255,255,0.14)');
      sheen.addColorStop(0.45, 'rgba(255,255,255,0.02)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      context.fillStyle = sheen;
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.fill();
      context.restore();

      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 2.2 * scale;
      context.stroke();
      arc(context, cx, cy, r + 5 * scale, Math.PI * 0.78, Math.PI * 1.22, 3 * scale, 'rgba(143,233,255,0.4)');

      // Bank angle, in a plate under the ball.
      const degrees = (roll * 180) / Math.PI;
      label(context, `${degrees >= 0 ? '+' : ''}${degrees.toFixed(0)}° BANK`, cx, cy + r + 16 * scale,
        10 * scale, Math.abs(degrees) > 45 ? COLOURS.amber : COLOURS.dim, 'center');
    },

    /** The compass ribbon along the top, with its lubber line and heading plate. */
    drawCompass() {
      const width = canvas.width;
      const scale = width / HUD.width;
      const w = BOX.compass.w * scale;
      const h = BOX.compass.h * scale;
      const x = width / 2 - w / 2;
      const y = BOX.compass.y * scale;

      panel(context, x, y, w, h, 4 * scale);

      const degreesPerPixel = 90 / w;
      const heading = state.heading;
      context.save();
      context.beginPath();
      context.rect(x, y, w, h);
      context.clip();
      for (let degrees = 0; degrees < 360; degrees += 5) {
        const offset = ((degrees - heading + 540) % 360) - 180;
        const tx = x + w / 2 + offset / degreesPerPixel;
        if (tx < x - 24 || tx > x + w + 24) continue;
        const cardinal = degrees % 90 === 0;
        const major = degrees % 10 === 0;
        context.strokeStyle = cardinal ? COLOURS.amber : major ? COLOURS.white : COLOURS.dim;
        context.lineWidth = (cardinal ? 2 : 1.2) * scale;
        context.beginPath();
        context.moveTo(tx, y + h);
        context.lineTo(tx, y + h - (cardinal ? 15 : major ? 10 : 5) * scale);
        context.stroke();
        if (cardinal) {
          const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
          label(context, names[degrees] ?? String(degrees), tx, y + 10 * scale, 12 * scale, COLOURS.amber, 'center');
        } else if (major && degrees % 30 === 0) {
          label(context, String(degrees), tx, y + 11 * scale, 8 * scale, COLOURS.dim, 'center');
        }
      }
      context.restore();

      context.fillStyle = COLOURS.amber;
      context.beginPath();
      context.moveTo(width / 2, y + h + 3 * scale);
      context.lineTo(width / 2 - 6 * scale, y + h + 12 * scale);
      context.lineTo(width / 2 + 6 * scale, y + h + 12 * scale);
      context.closePath();
      context.fill();

      const plateW = 52 * scale;
      plate(context, width / 2 - plateW / 2, y + h + 14 * scale, plateW, 20 * scale, COLOURS.amber);
      label(context, `${String(Math.round(heading)).padStart(3, '0')}`, width / 2,
        y + h + 24 * scale, 13 * scale, COLOURS.white, 'center');
    },

    /**
     * The minimap: the island's coast, the airfield, the rings of the course and the
     * aeroplane with its heading cone, in the upper right.
     */
    drawMinimap(flight, world) {
      const width = canvas.width;
      const scale = width / HUD.width;
      const size = BOX.minimap.size * scale;
      const x = width - size - BOX.minimap.right * scale;
      const y = BOX.minimap.y * scale;
      const range = 3800;

      panel(context, x, y, size, size, 8 * scale, 'rgba(9,16,22,0.7)');
      context.save();
      context.beginPath();
      context.roundRect(x, y, size, size, 8 * scale);
      context.clip();

      const centreX = x + size / 2;
      const centreY = y + size / 2;
      const toMap = size / (range * 2);
      const px = (wx) => centreX + (wx - flight.state.position.x) * toMap;
      const pz = (wz) => centreY + (wz - flight.state.position.z) * toMap;

      // The sea, then the coast, so the land reads as land.
      context.fillStyle = 'rgba(24,64,84,0.55)';
      context.fillRect(x, y, size, size);
      context.beginPath();
      for (let index = 0; index <= 96; index += 1) {
        const angle = (index / 96) * Math.PI * 2;
        const sampleX = Math.cos(angle) * 3500;
        const sampleZ = Math.sin(angle) * 3500;
        const ground = heightAt(sampleX, sampleZ);
        const k = ground > 1 ? 1 : 0.94;
        const mx = px(sampleX * k);
        const mz = pz(sampleZ * k);
        if (index === 0) context.moveTo(mx, mz);
        else context.lineTo(mx, mz);
      }
      context.closePath();
      context.fillStyle = 'rgba(96,132,72,0.42)';
      context.fill();
      context.strokeStyle = 'rgba(157,255,154,0.55)';
      context.lineWidth = 1.4 * scale;
      context.stroke();

      // The airfield: its shelf and the runway along it.
      context.strokeStyle = 'rgba(238,244,248,0.25)';
      context.lineWidth = 1 * scale;
      context.beginPath();
      context.arc(px(0), pz(0), 1150 * toMap, 0, Math.PI * 2);
      context.stroke();
      context.save();
      context.translate(px(0), pz(0));
      context.fillStyle = 'rgba(238,244,248,0.75)';
      context.fillRect(-2 * scale, -750 * toMap, 4 * scale, 1500 * toMap);
      context.restore();

      // The rings of the course, the next one bright and haloed.
      if (world && world.mission) {
        const index = world.mission.state.index;
        world.mission.rings.forEach((ring, i) => {
          const rx = px(ring.position.x);
          const rz = pz(ring.position.z);
          if (rx < x - 8 || rx > x + size + 8 || rz < y - 8 || rz > y + size + 8) return;
          const next = i === index;
          if (next) {
            context.strokeStyle = 'rgba(143,233,255,0.5)';
            context.lineWidth = 1.4 * scale;
            context.beginPath();
            context.arc(rx, rz, 9 * scale, 0, Math.PI * 2);
            context.stroke();
          }
          context.beginPath();
          context.arc(rx, rz, (next ? 4.5 : 2.8) * scale, 0, Math.PI * 2);
          context.fillStyle = next ? COLOURS.cyan : 'rgba(143,233,255,0.45)';
          context.fill();
        });
      }

      // The aeroplane, at the centre, with the cone it is heading down.
      context.save();
      context.translate(centreX, centreY);
      context.rotate(flight.state.heading);
      const cone = context.createLinearGradient(0, 0, 0, -46 * scale);
      cone.addColorStop(0, 'rgba(255,200,87,0.32)');
      cone.addColorStop(1, 'rgba(255,200,87,0)');
      context.fillStyle = cone;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(-20 * scale, -46 * scale);
      context.lineTo(20 * scale, -46 * scale);
      context.closePath();
      context.fill();
      context.fillStyle = COLOURS.amber;
      context.beginPath();
      context.moveTo(0, -8 * scale);
      context.lineTo(5 * scale, 6 * scale);
      context.lineTo(0, 3 * scale);
      context.lineTo(-5 * scale, 6 * scale);
      context.closePath();
      context.fill();
      context.restore();
      context.restore();

      // The caption, in its own strip along the map's bottom edge.
      context.fillStyle = 'rgba(6,12,18,0.78)';
      context.fillRect(x, y + size - 18 * scale, size, 18 * scale);
      label(context, 'SABLE REACH', x + 7 * scale, y + size - 9 * scale, 9 * scale, COLOURS.dim, 'left');
      label(context, `${range} m`, x + size - 7 * scale, y + size - 9 * scale, 9 * scale, COLOURS.dim, 'right');
    },

    /** The warnings, stacked in the clear band under the compass ribbon. */
    drawWarnings(flight) {
      const width = canvas.width;
      const scale = width / HUD.width;
      const warnings = [];
      if (flight.state.stallWarning > 0.55) warnings.push({ text: 'STALL', colour: COLOURS.red, blink: true });
      if (flight.state.fuel < 22) warnings.push({ text: 'LOW FUEL', colour: COLOURS.amber, blink: false });
      if (flight.state.damage > 0.35) warnings.push({ text: 'AIRFRAME DAMAGE', colour: COLOURS.red, blink: false });
      if (flight.heightAboveGround < 90 && flight.state.velocity.y < -6) {
        warnings.push({ text: 'SINK RATE', colour: COLOURS.amber, blink: false });
      }
      warnings.forEach((warning, index) => {
        const y = (BOX.warn.cy + index * 28) * scale;
        const alpha = warning.blink && Math.floor(state.fpsTimer * 6) % 2 === 0 ? 0.35 : 1;
        context.globalAlpha = alpha;
        const w = 150 * scale;
        plate(context, width / 2 - w / 2, y - 12 * scale, w, 24 * scale, warning.colour);
        label(context, warning.text, width / 2, y, 15 * scale, warning.colour, 'center');
        context.globalAlpha = 1;
      });
    },

    /**
     * The mission's panel: the name, the clock, the score, the next ring's guidance
     * and the distance to it, in four rows that each own their own line.
     */
    drawMission(mission) {
      const width = canvas.width;
      const scale = width / HUD.width;
      const x = BOX.mission.x * scale;
      const y = BOX.mission.y * scale;
      const w = BOX.mission.w * scale;
      const h = BOX.mission.h * scale;

      panel(context, x, y, w, h, 8 * scale);
      // The name, on its own line, with the quality preset opposite it.
      label(context, mission.name.toUpperCase(), x + 14 * scale, y + 16 * scale, 13 * scale, COLOURS.amber, 'left');

      // The clock, big, with its caption tucked to its right on the same line.
      const minutes = Math.floor(mission.timeLeft / 60);
      const seconds = Math.floor(mission.timeLeft % 60);
      const clockColour = mission.timeLeft < 20 ? COLOURS.red : COLOURS.white;
      label(context, `${minutes}:${String(seconds).padStart(2, '0')}`, x + 14 * scale, y + 46 * scale,
        30 * scale, clockColour, 'left');
      label(context, 'TIME LEFT', x + 96 * scale, y + 54 * scale, 9 * scale, COLOURS.dim, 'left');

      // The score, on the bottom line.
      label(context, `SCORE ${String(mission.score).padStart(6, '0')}`, x + 14 * scale, y + h - 14 * scale,
        13 * scale, COLOURS.white, 'left');

      // The next ring: the bar that fills as the pilot lines up, its count and its
      // range, all in the panel's right-hand column.
      const gx = x + 158 * scale;
      const gw = 128 * scale;
      context.fillStyle = 'rgba(30,40,50,0.9)';
      context.fillRect(gx, y + 10 * scale, gw, 11 * scale);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1 * scale;
      context.strokeRect(gx, y + 10 * scale, gw, 11 * scale);
      context.fillStyle = COLOURS.cyan;
      context.fillRect(gx + 1 * scale, y + 11 * scale, (gw - 2 * scale) * Math.max(0, Math.min(1, mission.guidance)), 9 * scale);

      const total = mission.ringsTotal || 9;
      label(context, `RING ${Math.min(mission.ringsPassed + 1, total)}/${total}`, gx, y + 34 * scale,
        11 * scale, COLOURS.dim, 'left');
      label(context, `${Math.round(mission.distance)} m`, gx + gw, y + 34 * scale, 12 * scale, COLOURS.white, 'right');
      label(context, `PASSED ${mission.ringsPassed}`, gx, y + 52 * scale, 10 * scale, COLOURS.dim, 'left');
      const best = Math.max(0, ...((mission.splits && mission.splits.length) ? mission.splits : [0]));
      label(context, `BEST ${String(best).padStart(3, '0')}s`, gx + gw, y + 52 * scale, 10 * scale, COLOURS.dim, 'right');
    },

    /** The throttle and the fuel, as two ruled bars along the bottom left. */
    drawBars() {
      const scale = canvas.width / HUD.width;
      const x = BOX.bars.x * scale;
      const y = BOX.bars.y * scale;
      const w = BOX.bars.w * scale;
      const barH = 13 * scale;

      const bar = (labelText, value, ratio, gradient, index) => {
        const by = y + index * 34 * scale;
        label(context, labelText, x, by - 1 * scale, 9 * scale, COLOURS.dim, 'left');
        const bx = x + 40 * scale;
        const bw = w - 40 * scale;
        context.fillStyle = 'rgba(30,40,50,0.85)';
        context.fillRect(bx, by - barH / 2, bw, barH);
        const fill = context.createLinearGradient(bx, 0, bx + bw, 0);
        fill.addColorStop(0, gradient[0]);
        fill.addColorStop(1, gradient[1]);
        context.fillStyle = fill;
        context.fillRect(bx + 1 * scale, by - barH / 2 + 1 * scale, (bw - 2 * scale) * ratio, barH - 2 * scale);
        // The ruler behind it, so the bar reads as a measured quantity.
        context.strokeStyle = 'rgba(9,16,22,0.6)';
        context.lineWidth = 1 * scale;
        for (let i = 1; i < 10; i += 1) {
          const tx = bx + (bw * i) / 10;
          context.beginPath();
          context.moveTo(tx, by - barH / 2);
          context.lineTo(tx, by + barH / 2);
          context.stroke();
        }
        context.strokeStyle = COLOURS.edge;
        context.lineWidth = 1.2 * scale;
        context.strokeRect(bx, by - barH / 2, bw, barH);
        label(context, value, bx + bw + 6 * scale, by, 11 * scale, COLOURS.white, 'left');
      };

      bar('THR', `${Math.round(state.throttle * 100)}%`, state.throttle, ['#5ad1ff', '#ffb257'], 0);
      const fuelRatio = Math.max(0, Math.min(1, state.fuel / 120));
      bar('FUEL', `${Math.round(state.fuel)}L`, fuelRatio,
        fuelRatio < 0.25 ? ['#ff6b5c', '#ff6b5c'] : ['#8fe9ff', '#9dff9a'], 1);
    },

    /**
     * The vertical-speed dial at the bottom right: a needle that reads climb and sink
     * against a scale in hundreds of feet a minute, its numbers outside the arc so
     * nothing overlaps.
     */
    drawVsi() {
      const width = canvas.width;
      const scale = width / HUD.width;
      const cx = width - BOX.vsi.right * scale;
      const cy = BOX.vsi.cy * scale;
      const r = BOX.vsi.r * scale;

      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.fillStyle = COLOURS.panel;
      context.fill();

      const from = Math.PI * 0.85;
      const sweep = Math.PI * 1.3;
      const at = (fpm) => from + (Math.max(-1000, Math.min(1000, fpm + 1000)) / 2000) * sweep;
      arc(context, cx, cy, r - 5 * scale, from, from + sweep, 6 * scale, 'rgba(30,40,50,0.9)');
      arc(context, cx, cy, r - 5 * scale, at(0), at(Math.round(state.climb * 196.85)), 6 * scale,
        state.climb < -3 ? COLOURS.red : state.climb < 0 ? COLOURS.amber : COLOURS.green);

      context.font = `${7.5 * scale}px ${HUD.font}`;
      for (let fpm = -1000; fpm <= 1000; fpm += 200) {
        const a = at(fpm);
        context.strokeStyle = fpm === 0 ? COLOURS.white : COLOURS.dim;
        context.lineWidth = 1.3 * scale;
        context.beginPath();
        context.moveTo(cx + Math.cos(a) * (r - 10 * scale), cy + Math.sin(a) * (r - 10 * scale));
        context.lineTo(cx + Math.cos(a) * (r - 2 * scale), cy + Math.sin(a) * (r - 2 * scale));
        context.stroke();
        if (fpm % 400 === 0) {
          context.fillStyle = COLOURS.dim;
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(String(Math.abs(fpm) / 100), cx + Math.cos(a) * (r + 8 * scale),
            cy + Math.sin(a) * (r + 8 * scale));
        }
      }
      const needle = at(Math.round(state.climb * 196.85));
      context.strokeStyle = COLOURS.white;
      context.lineWidth = 2.2 * scale;
      context.beginPath();
      context.moveTo(cx - Math.cos(needle) * 5 * scale, cy - Math.sin(needle) * 5 * scale);
      context.lineTo(cx + Math.cos(needle) * (r - 12 * scale), cy + Math.sin(needle) * (r - 12 * scale));
      context.stroke();
      context.beginPath();
      context.arc(cx, cy, 3.4 * scale, 0, Math.PI * 2);
      context.fillStyle = COLOURS.white;
      context.fill();
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1.8 * scale;
      context.stroke();
      label(context, 'VERT MINS', cx, cy + r - 12 * scale, 7.5 * scale, COLOURS.dim, 'center');
    },

    /** The high-lift setting, the load and the airframe, beside the vertical-speed dial. */
    drawRig(flight) {
      const scale = canvas.width / HUD.width;
      const w = BOX.rig.w * scale;
      const x = canvas.width - BOX.rig.right * scale - w;
      const y = BOX.rig.y * scale;
      const h = BOX.rig.h * scale;

      panel(context, x, y, w, h, 6 * scale);
      const notch = Math.round((flight.state.flaps ?? 0) * 3);
      const damage = flight.state.damage ?? 0;
      const g = flight.state.gForce ?? 1;
      const rows = [
        { name: 'FLAPS', value: ['UP', 'HALF', 'FULL', 'LAND'][Math.max(0, Math.min(3, notch))],
          ok: notch < 3 || flight.knots < 105 },
        { name: 'LOAD', value: `${g.toFixed(1)} G`, ok: g < 6.5 },
        { name: 'HULL', value: `${Math.round((1 - damage) * 100)}%`, ok: damage < 0.35 },
      ];
      rows.forEach((row, index) => {
        const ry = y + 15 * scale + index * 19 * scale;
        label(context, row.name, x + 10 * scale, ry, 9 * scale, COLOURS.dim, 'left');
        label(context, row.value, x + w - 16 * scale, ry, 11 * scale,
          row.ok ? COLOURS.green : COLOURS.red, 'right');
        // The lamp: a lit bead in the panel's right-hand gutter.
        context.beginPath();
        context.arc(x + w - 8 * scale, ry, 2.8 * scale, 0, Math.PI * 2);
        context.fillStyle = row.ok ? 'rgba(157,255,154,0.9)' : 'rgba(255,107,92,0.9)';
        context.fill();
      });
    },

    /** The frame rate and the preset in force, small and out of the way. */
    drawCorner(extra) {
      const scale = canvas.width / HUD.width;
      const key = extra && extra.quality ? extra.quality : 'high';
      label(context, `${state.fps} FPS · ${String(key).toUpperCase()}`, canvas.width - 26 * scale,
        canvas.height - 14 * scale, 10 * scale, COLOURS.dim, 'right');
    },
  };
}
