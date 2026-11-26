// The screens that sit over the game: the title, the mission brief, the pause
// menu and the final score. They are drawn on the HUD's own canvas, so the
// instruments stay behind them.
import { GAME, HUD, QUALITY } from './config.js';

const COLOURS = {
  white: '#eef4f8',
  dim: 'rgba(238,244,248,0.6)',
  amber: '#ffc857',
  cyan: '#8fe9ff',
  green: '#9dff9a',
  red: '#ff6b5c',
};

function label(context, text, x, y, size = 14, colour = COLOURS.dim, align = 'left') {
  context.font = `${size}px ${HUD.font}`;
  context.fillStyle = colour;
  context.textAlign = align;
  context.textBaseline = 'middle';
  context.fillText(text, x, y);
}

/** A dark panel with a bright edge, centred on the screen. */
function panel(context, x, y, width, height, scale) {
  context.fillStyle = 'rgba(6,12,18,0.86)';
  context.beginPath();
  context.roundRect(x, y, width, height, 10 * scale);
  context.fill();
  context.strokeStyle = 'rgba(143,233,255,0.35)';
  context.lineWidth = 1.4 * scale;
  context.stroke();
}

export function createMenus() {
  return {
    /**
     * The title screen: the game's name over a view of the island.
     */
    drawTitle(context, canvas, selection, quality) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;
      const gradient = context.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, 'rgba(4,10,18,0.78)');
      gradient.addColorStop(0.5, 'rgba(4,10,18,0.42)');
      gradient.addColorStop(1, 'rgba(4,10,18,0.8)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const titleY = height * 0.3;
      label(context, GAME.title, width / 2, titleY, 62 * scale, COLOURS.white, 'center');
      label(context, GAME.subtitle, width / 2, titleY + 46 * scale, 20 * scale, COLOURS.amber, 'center');
      label(context, `${GAME.aircraft} over ${GAME.world}`, width / 2, titleY + 76 * scale, 14 * scale, COLOURS.dim, 'center');

      const options = [
        'Start a sortie',
        'Time Trial',
        'Cargo Run',
        'Search and Rescue',
        `Quality: ${QUALITY[quality].label}`,
        'Sound: on',
      ];
      const startY = height * 0.52;
      options.forEach((option, index) => {
        const y = startY + index * 34 * scale;
        const active = index === selection;
        if (active) {
          context.fillStyle = 'rgba(143,233,255,0.12)';
          context.fillRect(width / 2 - 170 * scale, y - 15 * scale, 340 * scale, 30 * scale);
          label(context, '>', width / 2 - 158 * scale, y, 16 * scale, COLOURS.cyan, 'center');
        }
        label(context, option, width / 2, y, 17 * scale, active ? COLOURS.white : COLOURS.dim, 'center');
      });

      const controls = 'W/S pitch   A/D roll   Q/E rudder   Z/X throttle   Shift brake   F flaps   C view   P pause';
      label(context, controls, width / 2, height - 40 * scale, 13 * scale, COLOURS.dim, 'center');
      label(context, 'The mouse flies the aeroplane too: hold it and steer', width / 2, height - 22 * scale, 12 * scale, 'rgba(238,244,248,0.4)', 'center');
    },

    /** The mission's brief, before it starts. */
    drawBrief(context, canvas, mission, typeName) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;
      context.fillStyle = 'rgba(4,10,18,0.6)';
      context.fillRect(0, 0, width, height);
      const panelWidth = 520 * scale;
      const panelHeight = 210 * scale;
      const x = width / 2 - panelWidth / 2;
      const y = height / 2 - panelHeight / 2;
      panel(context, x, y, panelWidth, panelHeight, scale);
      label(context, typeName.toUpperCase(), width / 2, y + 34 * scale, 26 * scale, COLOURS.amber, 'center');
      label(context, mission.brief, width / 2, y + 72 * scale, 15 * scale, COLOURS.white, 'center');
      label(context, `${mission.rings.length} rings   ${Math.round(mission.timeLeft / 60)}:${String(Math.round(mission.timeLeft % 60)).padStart(2, '0')} on the clock`,
        width / 2, y + 106 * scale, 15 * scale, COLOURS.dim, 'center');
      label(context, 'Press ENTER to fly', width / 2, y + 150 * scale, 18 * scale, COLOURS.cyan, 'center');
      label(context, 'Fly through every ring, then land on the runway at Reach Field', width / 2, y + 180 * scale, 12 * scale, COLOURS.dim, 'center');
    },

    /** The pause menu. */
    drawPause(context, canvas, quality, muted) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;
      context.fillStyle = 'rgba(4,10,18,0.6)';
      context.fillRect(0, 0, width, height);
      const panelWidth = 380 * scale;
      const panelHeight = 190 * scale;
      const x = width / 2 - panelWidth / 2;
      const y = height / 2 - panelHeight / 2;
      panel(context, x, y, panelWidth, panelHeight, scale);
      label(context, 'PAUSED', width / 2, y + 34 * scale, 26 * scale, COLOURS.white, 'center');
      const options = ['Resume', `Quality: ${QUALITY[quality].label}`, `Sound: ${muted ? 'off' : 'on'}`, 'Restart the sortie', 'Quit to the title'];
      options.forEach((option, index) => {
        label(context, option, width / 2, y + 76 * scale + index * 24 * scale, 15 * scale, COLOURS.dim, 'center');
      });
    },

    /**
     * The final score: how the sortie went, with the landing's own marks.
     */
    drawResults(context, canvas, mission, summary) {
      const width = canvas.width;
      const height = canvas.height;
      const scale = width / HUD.width;
      context.fillStyle = 'rgba(4,10,18,0.72)';
      context.fillRect(0, 0, width, height);
      const panelWidth = 560 * scale;
      const panelHeight = 340 * scale;
      const x = width / 2 - panelWidth / 2;
      const y = height / 2 - panelHeight / 2;
      panel(context, x, y, panelWidth, panelHeight, scale);

      const success = mission.outcome === 'landed';
      label(context, success ? 'SORTIE COMPLETE' : 'SORTIE ENDED', width / 2, y + 34 * scale, 26 * scale,
        success ? COLOURS.green : COLOURS.red, 'center');
      label(context, mission.name, width / 2, y + 58 * scale, 14 * scale, COLOURS.dim, 'center');

      const rows = [
        ['Rings flown', `${mission.ringsPassed} of ${mission.rings.length}`],
        ['Time left', `${Math.floor(mission.timeLeft / 60)}:${String(Math.floor(mission.timeLeft % 60)).padStart(2, '0')}`],
        ['Fuel remaining', `${Math.round(summary.fuel)} litres`],
        ['Airframe', summary.damage < 0.2 ? 'Sound' : summary.damage < 0.6 ? 'Dented' : 'Damaged'],
        ['Landing', summary.landing ? `${summary.landing.score} points` : 'Not landed'],
      ];
      rows.forEach((row, index) => {
        const rowY = y + 96 * scale + index * 24 * scale;
        label(context, row[0], x + 40 * scale, rowY, 15 * scale, COLOURS.dim, 'left');
        label(context, row[1], x + panelWidth - 40 * scale, rowY, 15 * scale, COLOURS.white, 'right');
      });

      label(context, 'FINAL SCORE', width / 2, y + 238 * scale, 14 * scale, COLOURS.dim, 'center');
      label(context, String(mission.score), width / 2, y + 272 * scale, 46 * scale, COLOURS.amber, 'center');
      label(context, 'Press ENTER to fly again', width / 2, y + 312 * scale, 15 * scale, COLOURS.cyan, 'center');
    },
  };
}
