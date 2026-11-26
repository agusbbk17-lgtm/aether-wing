// The HUD, drawn on its own 2D canvas over the 3D picture: an artificial horizon,
// an airspeed tape, an altitude tape, a compass ribbon, a throttle and fuel bar,
// the stall warning, the mission's clock, the next ring's guidance and a minimap.
// The instruments are drawn as flown instruments: they move with lag, they have
// bezels and glass, and they are lit from within.
import { GAME, HUD, PALETTE } from './config.js';
import { heightAt } from './terrain.js';

const COLOURS = {
  green: '#9dff9a',
  amber: '#ffc857',
  red: '#ff6b5c',
  cyan: '#8fe9ff',
  white: '#eef4f8',
  dim: 'rgba(238,244,248,0.55)',
  panel: 'rgba(9,16,22,0.62)',
  edge: 'rgba(160,200,225,0.35)',
};

/** Draws a filled arc, from one angle to another. */
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

export function createHud(canvas) {
  const context = canvas.getContext('2d');
  const state = {
    /** The smoothed airspeed, in knots, so the needle does not jump. */
    speed: 0,
    /** The smoothed altitude, in metres. */
    altitude: 0,
    /** The smoothed heading, in degrees. */
    heading: 0,
    /** The smoothed rate of climb, in metres per second. */
    climb: 0,
    /** The smoothed fuel, in litres. */
    fuel: 120,
    /** The smoothed throttle, 0..1. */
    throttle: 0,
    /** The last frame's time, for the frame-rate counter. */
    frames: 0,
    fps: 60,
    fpsTimer: 0,
  };

  return {
    state,
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

      // The smoothed values.
      const knots = flight.knots;
      state.speed += (knots - state.speed) * Math.min(1, delta * 8);
      state.altitude += (flight.state.position.y - state.altitude) * Math.min(1, delta * 8);
      state.fuel += (flight.state.fuel - state.fuel) * Math.min(1, delta * 6);
      state.throttle += (flight.state.throttle - state.throttle) * Math.min(1, delta * 8);
      let heading = (flight.state.heading * 180) / Math.PI;
      if (heading < 0) heading += 360;
      let headingDelta = heading - state.heading;
      if (headingDelta > 180) headingDelta -= 360;
      if (headingDelta < -180) headingDelta += 360;
      state.heading += headingDelta * Math.min(1, delta * 8);
      const climbNow = flight.state.velocity.y;
      state.climb += (climbNow - state.climb) * Math.min(1, delta * 5);

      state.fpsTimer += delta;
      if (state.fpsTimer > 0.5) {
        state.fps = Math.round(state.frames / state.fpsTimer);
        state.frames = 0;
        state.fpsTimer = 0;
      }
      state.frames += 1;

      this.drawInstruments(flight, mission, extra);
      this.drawTapes(flight, mission);
      this.drawCompass(flight);
      this.drawMinimap(flight, world);
      this.drawWarnings(flight, mission);
      this.drawMission(flight, mission);
    },

    /**
     * The artificial horizon and the round gauges: the airspeed, the altitude and
     * the compass rose, each in its own bezel.
     */
    drawInstruments(flight, mission, extra) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;

      // --- The artificial horizon, at the bottom centre.
      const horizonX = width / 2;
      const horizonY = height - 176 * scale;
      const radius = HUD.gaugeRadius * scale;

      context.save();
      context.beginPath();
      context.arc(horizonX, horizonY, radius, 0, Math.PI * 2);
      context.fillStyle = COLOURS.panel;
      context.fill();
      context.clip();

      // The sky and the ground, turned by the aeroplane's roll and pitch.
      const roll = -flight.state.roll;
      const pitchOffset = flight.state.pitch * 190 * scale;
      context.save();
      context.translate(horizonX, horizonY);
      context.rotate(roll);
      context.translate(0, pitchOffset);

      const skyGradient = context.createLinearGradient(0, -radius * 3, 0, radius);
      skyGradient.addColorStop(0, '#2b6ea8');
      skyGradient.addColorStop(1, '#8fb9d6');
      context.fillStyle = skyGradient;
      context.fillRect(-radius * 2, -radius * 3, radius * 4, radius * 3);
      context.fillStyle = '#6d5a35';
      context.fillRect(-radius * 2, 0, radius * 4, radius * 3);

      // The horizon line, with its pitch ladder.
      context.strokeStyle = 'rgba(255,255,255,0.9)';
      context.lineWidth = 1.6 * scale;
      context.beginPath();
      context.moveTo(-radius * 2, 0);
      context.lineTo(radius * 2, 0);
      context.stroke();
      context.strokeStyle = 'rgba(255,255,255,0.6)';
      context.lineWidth = 1.1 * scale;
      for (let degrees = -30; degrees <= 30; degrees += 10) {
        if (degrees === 0) continue;
        const y = -degrees * 3.1 * scale;
        const halfWidth = degrees % 20 === 0 ? radius * 0.42 : radius * 0.24;
        context.beginPath();
        context.moveTo(-halfWidth, y);
        context.lineTo(halfWidth, y);
        context.stroke();
      }
      context.restore();

      // The aeroplane's own mark, fixed at the centre of the instrument.
      context.strokeStyle = COLOURS.amber;
      context.lineWidth = 2.4 * scale;
      context.beginPath();
      context.moveTo(horizonX - radius * 0.44, horizonY);
      context.lineTo(horizonX - radius * 0.16, horizonY);
      context.moveTo(horizonX + radius * 0.16, horizonY);
      context.lineTo(horizonX + radius * 0.44, horizonY);
      context.stroke();
      context.beginPath();
      context.arc(horizonX, horizonY, 2.6 * scale, 0, Math.PI * 2);
      context.stroke();

      // The bezel and the glass.
      context.restore();
      context.beginPath();
      context.arc(horizonX, horizonY, radius, 0, Math.PI * 2);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 2.4 * scale;
      context.stroke();
      arc(context, horizonX, horizonY, radius + 6 * scale, Math.PI * 0.72, Math.PI * 1.28, 3 * scale, 'rgba(143,233,255,0.35)');

      // --- The airspeed gauge, at the bottom left.
      const speedX = 150 * scale;
      const speedY = height - 176 * scale;
      const speedRadius = 52 * scale;
      context.beginPath();
      context.arc(speedX, speedY, speedRadius, 0, Math.PI * 2);
      context.fillStyle = COLOURS.panel;
      context.fill();
      arc(context, speedX, speedY, speedRadius - 4 * scale, Math.PI * 0.75, Math.PI * 2.25, 8 * scale, 'rgba(30,40,50,0.9)');

      // The arc fills with the speed: green in the normal range, amber near the
      // stall, red beyond it.
      const speedRatio = Math.min(1, state.speed / 220);
      const speedAngle = Math.PI * 0.75 + speedRatio * Math.PI * 1.5;
      const stallAngle = Math.PI * 0.75 + (48 / 220) * Math.PI * 1.5;
      arc(context, speedX, speedY, speedRadius - 4 * scale, Math.PI * 0.75, stallAngle, 8 * scale, 'rgba(157,255,154,0.35)');
      arc(context, speedX, speedY, speedRadius - 4 * scale, stallAngle, speedAngle, 8 * scale, 'rgba(255,200,87,0.8)');
      arc(context, speedX, speedY, speedRadius - 4 * scale, speedAngle, Math.PI * 2.25, 8 * scale, 'rgba(255,107,92,0.55)');

      // The ticks.
      for (let knots = 0; knots <= 220; knots += 20) {
        const angle = Math.PI * 0.75 + (knots / 220) * Math.PI * 1.5;
        const inner = speedRadius - 12 * scale;
        const outer = speedRadius - (knots % 40 === 0 ? 22 : 17) * scale;
        context.strokeStyle = knots % 40 === 0 ? COLOURS.white : COLOURS.dim;
        context.lineWidth = 1.4 * scale;
        context.beginPath();
        context.moveTo(speedX + Math.cos(angle) * inner, speedY + Math.sin(angle) * inner);
        context.lineTo(speedX + Math.cos(angle) * outer, speedY + Math.sin(angle) * outer);
        context.stroke();
        if (knots % 40 === 0) {
          label(context, String(knots), speedX + Math.cos(angle) * (inner - 12 * scale),
            speedY + Math.sin(angle) * (inner - 12 * scale), 10 * scale, COLOURS.dim, 'center');
        }
      }
      // The needle.
      context.strokeStyle = COLOURS.white;
      context.lineWidth = 2.6 * scale;
      context.beginPath();
      context.moveTo(speedX, speedY);
      context.lineTo(speedX + Math.cos(speedAngle) * (speedRadius - 14 * scale), speedY + Math.sin(speedAngle) * (speedRadius - 14 * scale));
      context.stroke();
      context.beginPath();
      context.arc(speedX, speedY, 4 * scale, 0, Math.PI * 2);
      context.fillStyle = COLOURS.white;
      context.fill();
      context.beginPath();
      context.arc(speedX, speedY, speedRadius, 0, Math.PI * 2);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 2 * scale;
      context.stroke();

      label(context, 'KNOTS', speedX, speedY + 22 * scale, 10 * scale, COLOURS.dim, 'center');
      label(context, String(Math.round(state.speed)), speedX, speedY - 22 * scale, 22 * scale, COLOURS.white, 'center');

      // --- The altitude gauge, at the bottom right.
      const altX = width - 150 * scale;
      const altY = height - 176 * scale;
      const altRadius = 52 * scale;
      context.beginPath();
      context.arc(altX, altY, altRadius, 0, Math.PI * 2);
      context.fillStyle = COLOURS.panel;
      context.fill();
      arc(context, altX, altY, altRadius - 4 * scale, Math.PI * 0.75, Math.PI * 2.25, 8 * scale, 'rgba(30,40,50,0.9)');
      for (let metres = 0; metres <= 1200; metres += 100) {
        const angle = Math.PI * 0.75 + (metres / 1200) * Math.PI * 1.5;
        const inner = altRadius - 12 * scale;
        const outer = altRadius - (metres % 200 === 0 ? 22 : 17) * scale;
        context.strokeStyle = metres % 200 === 0 ? COLOURS.white : COLOURS.dim;
        context.lineWidth = 1.4 * scale;
        context.beginPath();
        context.moveTo(altX + Math.cos(angle) * inner, altY + Math.sin(angle) * inner);
        context.lineTo(altX + Math.cos(angle) * outer, altY + Math.sin(angle) * outer);
        context.stroke();
        if (metres % 200 === 0) {
          label(context, String(metres), altX + Math.cos(angle) * (inner - 11 * scale),
            altY + Math.sin(angle) * (inner - 11 * scale), 10 * scale, COLOURS.dim, 'center');
        }
      }
      const altAngle = Math.PI * 0.75 + Math.min(1, state.altitude / 1200) * Math.PI * 1.5;
      context.strokeStyle = COLOURS.cyan;
      context.lineWidth = 2.6 * scale;
      context.beginPath();
      context.moveTo(altX, altY);
      context.lineTo(altX + Math.cos(altAngle) * (altRadius - 14 * scale), altY + Math.sin(altAngle) * (altRadius - 14 * scale));
      context.stroke();
      context.beginPath();
      context.arc(altX, altY, 4 * scale, 0, Math.PI * 2);
      context.fillStyle = COLOURS.cyan;
      context.fill();
      context.beginPath();
      context.arc(altX, altY, altRadius, 0, Math.PI * 2);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 2 * scale;
      context.stroke();
      label(context, 'METRES', altX, altY + 22 * scale, 10 * scale, COLOURS.dim, 'center');
      label(context, String(Math.round(state.altitude)), altX, altY - 22 * scale, 22 * scale, COLOURS.white, 'center');

      // The rate of climb, beside the altitude gauge.
      const climbMetres = state.climb * 60;
      label(context, climbMetres >= 0 ? '+' : '', altX + 82 * scale, altY - 8 * scale, 13 * scale, COLOURS.dim, 'left');
      label(context, `${Math.round(climbMetres)} m/min`, altX + 90 * scale, altY - 8 * scale, 14 * scale,
        climbMetres < -200 ? COLOURS.red : climbMetres < 0 ? COLOURS.amber : COLOURS.green, 'left');

      // --- The throttle and fuel, up on the left.
      const barX = 26 * scale;
      const barY = 150 * scale;
      const barHeight = 190 * scale;
      const barWidth = 16 * scale;
      context.fillStyle = COLOURS.panel;
      context.fillRect(barX, barY, barWidth, barHeight);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1.4 * scale;
      context.strokeRect(barX, barY, barWidth, barHeight);
      const throttleHeight = barHeight * state.throttle;
      const throttleGradient = context.createLinearGradient(0, barY + barHeight, 0, barY);
      throttleGradient.addColorStop(0, '#5ad1ff');
      throttleGradient.addColorStop(1, '#ffb257');
      context.fillStyle = throttleGradient;
      context.fillRect(barX + 2 * scale, barY + barHeight - throttleHeight + 2 * scale, barWidth - 4 * scale, throttleHeight - 4 * scale);
      label(context, 'THR', barX + barWidth / 2, barY - 12 * scale, 11 * scale, COLOURS.dim, 'center');
      label(context, `${Math.round(state.throttle * 100)}%`, barX + barWidth / 2, barY + barHeight + 14 * scale, 11 * scale, COLOURS.white, 'center');

      // The fuel, beside the throttle.
      const fuelX = barX + 26 * scale;
      context.fillStyle = COLOURS.panel;
      context.fillRect(fuelX, barY, barWidth, barHeight);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1.4 * scale;
      context.strokeRect(fuelX, barY, barWidth, barHeight);
      const fuelRatio = Math.max(0, Math.min(1, state.fuel / 120));
      const fuelGradient = context.createLinearGradient(0, barY + barHeight, 0, barY);
      fuelGradient.addColorStop(0, '#8fe9ff');
      fuelGradient.addColorStop(1, fuelRatio < 0.25 ? '#ff6b5c' : '#9dff9a');
      context.fillStyle = fuelGradient;
      context.fillRect(fuelX + 2 * scale, barY + barHeight - barHeight * fuelRatio + 2 * scale, barWidth - 4 * scale, barHeight * fuelRatio - 4 * scale);
      label(context, 'FUEL', fuelX + barWidth / 2, barY - 12 * scale, 11 * scale, COLOURS.dim, 'center');
      label(context, `${Math.round(state.fuel)}`, fuelX + barWidth / 2, barY + barHeight + 14 * scale, 11 * scale, COLOURS.white, 'center');
    },

    /**
     * The speed and altitude tapes, up on the left and the right edges.
     */
    drawTapes(flight, mission) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;

      // The airspeed tape, on the left.
      const tapeX = 232 * scale;
      const tapeTop = 118 * scale;
      const tapeHeight = 300 * scale;
      const tapeWidth = HUD.tapeWidth * scale;
      context.fillStyle = COLOURS.panel;
      context.fillRect(tapeX, tapeTop, tapeWidth, tapeHeight);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1.3 * scale;
      context.strokeRect(tapeX, tapeTop, tapeWidth, tapeHeight);

      const pixelsPerKnot = tapeHeight / 220;
      const centre = tapeTop + tapeHeight / 2;
      for (let knots = 0; knots <= 220; knots += 10) {
        const y = centre + (state.speed - knots) * pixelsPerKnot;
        if (y < tapeTop - 20 || y > tapeTop + tapeHeight + 20) continue;
        const major = knots % 20 === 0;
        context.strokeStyle = major ? COLOURS.white : COLOURS.dim;
        context.lineWidth = 1.2 * scale;
        context.beginPath();
        context.moveTo(tapeX, y);
        context.lineTo(tapeX + (major ? 12 : 7) * scale, y);
        context.stroke();
        if (major) {
          label(context, String(knots), tapeX + 16 * scale, y, 11 * scale, COLOURS.dim, 'left');
        }
      }
      // The readout, in a little window on the tape.
      context.fillStyle = 'rgba(8,14,20,0.92)';
      context.fillRect(tapeX - 4 * scale, centre - 13 * scale, tapeWidth + 8 * scale, 26 * scale);
      context.strokeStyle = COLOURS.amber;
      context.lineWidth = 1.6 * scale;
      context.strokeRect(tapeX - 4 * scale, centre - 13 * scale, tapeWidth + 8 * scale, 26 * scale);
      label(context, String(Math.round(state.speed)), tapeX + tapeWidth / 2, centre, 16 * scale, COLOURS.white, 'center');

      // The altitude tape, on the right.
      const altTapeX = width - 232 * scale - tapeWidth;
      context.fillStyle = COLOURS.panel;
      context.fillRect(altTapeX, tapeTop, tapeWidth, tapeHeight);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1.3 * scale;
      context.strokeRect(altTapeX, tapeTop, tapeWidth, tapeHeight);
      const pixelsPerMetre = tapeHeight / 1200;
      for (let metres = 0; metres <= 1200; metres += 50) {
        const y = centre + (state.altitude - metres) * pixelsPerMetre;
        if (y < tapeTop - 20 || y > tapeTop + tapeHeight + 20) continue;
        const major = metres % 100 === 0;
        context.strokeStyle = major ? COLOURS.white : COLOURS.dim;
        context.lineWidth = 1.2 * scale;
        context.beginPath();
        context.moveTo(altTapeX + tapeWidth - (major ? 12 : 7) * scale, y);
        context.lineTo(altTapeX + tapeWidth, y);
        context.stroke();
        if (major) {
          label(context, String(metres), altTapeX + tapeWidth - 16 * scale, y, 11 * scale, COLOURS.dim, 'right');
        }
      }
      context.fillStyle = 'rgba(8,14,20,0.92)';
      context.fillRect(altTapeX - 4 * scale, centre - 13 * scale, tapeWidth + 8 * scale, 26 * scale);
      context.strokeStyle = COLOURS.cyan;
      context.lineWidth = 1.6 * scale;
      context.strokeRect(altTapeX - 4 * scale, centre - 13 * scale, tapeWidth + 8 * scale, 26 * scale);
      label(context, String(Math.round(state.altitude)), altTapeX + tapeWidth / 2, centre, 16 * scale, COLOURS.white, 'center');
    },

    /** The compass ribbon, along the top. */
    drawCompass(flight) {
      const width = canvas.width;
      const scale = width / HUD.width;
      const ribbonY = 40 * scale;
      const ribbonHeight = 34 * scale;
      const ribbonWidth = 420 * scale;
      const ribbonX = width / 2 - ribbonWidth / 2;

      context.fillStyle = COLOURS.panel;
      context.fillRect(ribbonX, ribbonY, ribbonWidth, ribbonHeight);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1.2 * scale;
      context.strokeRect(ribbonX, ribbonY, ribbonWidth, ribbonHeight);

      const degreesPerPixel = 90 / ribbonWidth;
      const heading = state.heading;
      context.save();
      context.beginPath();
      context.rect(ribbonX, ribbonY, ribbonWidth, ribbonHeight);
      context.clip();
      for (let degrees = 0; degrees < 360; degrees += 5) {
        const offset = (degrees - heading + 540) % 360 - 180;
        const x = ribbonX + ribbonWidth / 2 + offset / degreesPerPixel;
        if (x < ribbonX - 20 || x > ribbonX + ribbonWidth + 20) continue;
        const cardinal = degrees % 90 === 0;
        const major = degrees % 10 === 0;
        context.strokeStyle = cardinal ? COLOURS.amber : major ? COLOURS.white : COLOURS.dim;
        context.lineWidth = (cardinal ? 2 : 1.2) * scale;
        context.beginPath();
        context.moveTo(x, ribbonY + ribbonHeight);
        context.lineTo(x, ribbonY + ribbonHeight - (cardinal ? 16 : major ? 11 : 6) * scale);
        context.stroke();
        if (cardinal) {
          const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
          label(context, names[degrees] ?? String(degrees), x, ribbonY + 11 * scale, 13 * scale, COLOURS.amber, 'center');
        }
      }
      context.restore();

      // The lubber line: the mark that shows the heading.
      context.fillStyle = COLOURS.amber;
      context.beginPath();
      context.moveTo(width / 2, ribbonY + ribbonHeight + 3 * scale);
      context.lineTo(width / 2 - 7 * scale, ribbonY + ribbonHeight + 14 * scale);
      context.lineTo(width / 2 + 7 * scale, ribbonY + ribbonHeight + 14 * scale);
      context.closePath();
      context.fill();

      // The heading's own number, below the ribbon.
      label(context, `${String(Math.round(heading)).padStart(3, '0')}°`, width / 2, ribbonY + ribbonHeight + 26 * scale, 16 * scale, COLOURS.white, 'center');
    },

    /**
     * The minimap: the island's shape, the runway, the rings and the aeroplane.
     */
    drawMinimap(flight, world) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;
      const size = HUD.minimapSize * scale;
      const x = width - size - 26 * scale;
      const y = 26 * scale;
      const range = 2600;

      context.fillStyle = 'rgba(9,16,22,0.68)';
      context.beginPath();
      context.roundRect(x, y, size, size, 8 * scale);
      context.fill();
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1.4 * scale;
      context.stroke();

      context.save();
      context.beginPath();
      context.roundRect(x, y, size, size, 8 * scale);
      context.clip();

      const centreX = x + size / 2;
      const centreY = y + size / 2;
      const scaleMap = size / (range * 2);

      // The island's coast, drawn as a ring of points.
      context.beginPath();
      for (let index = 0; index <= 72; index += 1) {
        const angle = (index / 72) * Math.PI * 2;
        const sampleX = Math.cos(angle) * 3400;
        const sampleZ = Math.sin(angle) * 3400;
        const ground = heightAt(sampleX, sampleZ);
        const px = centreX + sampleX * scaleMap;
        const py = centreY + sampleZ * scaleMap;
        if (index === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.strokeStyle = 'rgba(157,255,154,0.5)';
      context.lineWidth = 1.6 * scale;
      context.stroke();
      context.fillStyle = 'rgba(80,120,60,0.22)';
      context.fill();

      // The airfield and its runway.
      context.fillStyle = 'rgba(238,244,248,0.55)';
      context.fillRect(centreX - 2 * scale, centreY - 46 * scale, 4 * scale, 92 * scale);

      // The rings of the course, the next one bright.
      if (world && world.mission) {
        world.mission.rings.forEach((ring, index) => {
          const px = centreX + ring.position.x * scaleMap;
          const py = centreY + ring.position.z * scaleMap;
          const isNext = index === world.mission.state.index;
          context.beginPath();
          context.arc(px, py, (isNext ? 5 : 3) * scale, 0, Math.PI * 2);
          context.fillStyle = isNext ? COLOURS.cyan : 'rgba(143,233,255,0.4)';
          context.fill();
        });
      }

      // The aeroplane: a mark in the shape of an aeroplane, pointing its way.
      const planeX = centreX + flight.state.position.x * scaleMap;
      const planeY = centreY + flight.state.position.z * scaleMap;
      context.save();
      context.translate(planeX, planeY);
      context.rotate(flight.state.heading);
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
      label(context, 'SABLE REACH', x + 8 * scale, y + size - 12 * scale, 10 * scale, COLOURS.dim, 'left');
    },

    /** The warnings: a stall, a low fuel, a damaged aeroplane. */
    drawWarnings(flight, mission) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;

      const warnings = [];
      if (flight.state.stallWarning > 0.55) warnings.push({ text: 'STALL', colour: COLOURS.red, blink: true });
      if (flight.state.fuel < 22) warnings.push({ text: 'LOW FUEL', colour: COLOURS.amber, blink: false });
      if (flight.state.damage > 0.35) warnings.push({ text: 'AIRFRAME DAMAGE', colour: COLOURS.red, blink: false });
      if (flight.heightAboveGround < 90 && flight.state.velocity.y < -6) {
        warnings.push({ text: 'SINK RATE', colour: COLOURS.amber, blink: false });
      }
      warnings.forEach((warning, index) => {
        const y = 120 * scale + index * 26 * scale;
        const alpha = warning.blink && Math.floor(state.fpsTimer * 6) % 2 === 0 ? 0.35 : 1;
        context.globalAlpha = alpha;
        label(context, warning.text, width / 2, y, 19 * scale, warning.colour, 'center');
        context.globalAlpha = 1;
      });
    },

    /** The mission's panel: the name, the clock, the score and the next ring. */
    drawMission(flight, mission) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;
      const x = 26 * scale;
      const y = 26 * scale;

      context.fillStyle = COLOURS.panel;
      context.beginPath();
      context.roundRect(x, y, 268 * scale, 96 * scale, 8 * scale);
      context.fill();
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1.2 * scale;
      context.stroke();

      label(context, mission.name.toUpperCase(), x + 14 * scale, y + 20 * scale, 14 * scale, COLOURS.amber, 'left');
      const minutes = Math.floor(mission.timeLeft / 60);
      const seconds = Math.floor(mission.timeLeft % 60);
      const clockColour = mission.timeLeft < 20 ? COLOURS.red : COLOURS.white;
      label(context, `${minutes}:${String(seconds).padStart(2, '0')}`, x + 14 * scale, y + 48 * scale, 30 * scale, clockColour, 'left');
      label(context, 'TIME LEFT', x + 120 * scale, y + 56 * scale, 11 * scale, COLOURS.dim, 'left');
      label(context, `SCORE ${String(mission.score).padStart(6, '0')}`, x + 14 * scale, y + 78 * scale, 14 * scale, COLOURS.white, 'left');

      // The next ring's guidance: a bar that fills as the pilot lines up, and
      // the distance to it.
      const guideX = x + 150 * scale;
      const guideY = y + 26 * scale;
      const guideWidth = 100 * scale;
      context.fillStyle = 'rgba(30,40,50,0.9)';
      context.fillRect(guideX, guideY, guideWidth, 12 * scale);
      context.strokeStyle = COLOURS.edge;
      context.lineWidth = 1 * scale;
      context.strokeRect(guideX, guideY, guideWidth, 12 * scale);
      context.fillStyle = COLOURS.cyan;
      context.fillRect(guideX + 1 * scale, guideY + 1 * scale, (guideWidth - 2 * scale) * mission.guidance, 10 * scale);
      const totalRings = mission.ringsTotal || (mission.rings ? mission.rings.length : (world?.mission?.rings?.length ?? 9));
      label(context, `RING ${Math.min(mission.ringsPassed + 1, totalRings)}/${totalRings}`,
        guideX, guideY + 26 * scale, 12 * scale, COLOURS.dim, 'left');
      label(context, `${Math.round(mission.distance)} m`, guideX + guideWidth, guideY + 26 * scale, 12 * scale, COLOURS.white, 'right');
    },
  };
}
