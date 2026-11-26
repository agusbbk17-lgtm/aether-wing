// The sound of the aeroplane, made in the browser with WebAudio: no file is
// loaded. The engine is a stack of sawtooth and square oscillators whose
// frequency and filter follow the throttle, the wind is filtered noise whose
// level follows the airspeed, and the stall horn, the ring chime and the
// touchdown thump are short envelopes on the same graph.
export function createAudio() {
  let context = null;
  let master = null;
  let engine = null;
  let wind = null;
  let nodes = null;
  let muted = false;
  let started = false;

  /** Builds the graph, once the browser has let the game start a sound. */
  function ensure() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = 0.55;
    master.connect(context.destination);
    return context;
  }

  /** A noise buffer of white noise, looped, for the wind and the surf. */
  function createNoiseBuffer(seconds = 2) {
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      // Brown-ish noise: it sounds like air, not like a hiss.
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[index] = last * 3.2;
    }
    return buffer;
  }

  /** Starts the engine and the wind. */
  function start() {
    if (started) return;
    if (!ensure()) return;
    if (context.state === 'suspended') context.resume();
    started = true;

    // --- The engine: three oscillators, a little detuned, through a low-pass
    // filter that opens as the throttle goes up.
    const engineGain = context.createGain();
    engineGain.gain.value = 0;
    const engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 700;
    engineFilter.Q.value = 3.2;
    engineGain.connect(engineFilter);
    engineFilter.connect(master);

    const oscillatorA = context.createOscillator();
    oscillatorA.type = 'sawtooth';
    oscillatorA.frequency.value = 42;
    const oscillatorB = context.createOscillator();
    oscillatorB.type = 'square';
    oscillatorB.frequency.value = 63;
    const oscillatorC = context.createOscillator();
    oscillatorC.type = 'sawtooth';
    oscillatorC.frequency.value = 84;
    const gainB = context.createGain();
    gainB.gain.value = 0.35;
    const gainC = context.createGain();
    gainC.gain.value = 0.22;
    oscillatorA.connect(engineGain);
    oscillatorB.connect(gainB);
    gainB.connect(engineGain);
    oscillatorC.connect(gainC);
    gainC.connect(engineGain);
    oscillatorA.start();
    oscillatorB.start();
    oscillatorC.start();

    // The propellor's blade beat: a fast tremolo on the engine's level.
    const tremolo = context.createOscillator();
    tremolo.type = 'sine';
    tremolo.frequency.value = 14;
    const tremoloGain = context.createGain();
    tremoloGain.gain.value = 0.12;
    tremolo.connect(tremoloGain);
    tremoloGain.connect(engineGain.gain);
    tremolo.start();

    // --- The wind: noise through a band-pass that opens with the airspeed.
    const noise = context.createBufferSource();
    noise.buffer = createNoiseBuffer(3);
    noise.loop = true;
    const windFilter = context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 480;
    windFilter.Q.value = 0.7;
    const windGain = context.createGain();
    windGain.gain.value = 0;
    noise.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(master);
    noise.start();

    nodes = { engineGain, engineFilter, oscillatorA, oscillatorB, oscillatorC, windGain, windFilter, tremolo };
    engine = { gain: engineGain, filter: engineFilter, oscillators: [oscillatorA, oscillatorB, oscillatorC] };
    wind = { gain: windGain, filter: windFilter };
  }

  /** A short beep: the ring chime, the warning tone. */
  function beep(frequency = 880, duration = 0.18, type = 'triangle', volume = 0.3) {
    if (!context || muted) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(volume, context.currentTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start();
    oscillator.stop(context.currentTime + duration + 0.02);
  }

  /** A burst of noise: the touchdown, a crash, a gust. */
  function burst(volume = 0.5, duration = 0.4, lowpass = 900) {
    if (!context || muted) return;
    const source = context.createBufferSource();
    source.buffer = createNoiseBuffer(0.6);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    source.stop(context.currentTime + duration + 0.05);
  }

  return {
    start,
    /** Follows the aeroplane: the engine's note and the wind's voice. */
    update(flight, throttle, airborne) {
      if (!context || !engine) return;
      const now = context.currentTime;
      const speed = flight.velocity.length();
      const rpm = 0.28 + throttle * 0.72;
      const base = 34 + rpm * 96 + Math.min(speed, 120) * 0.22;
      engine.oscillators[0].frequency.setTargetAtTime(base, now, 0.08);
      engine.oscillators[1].frequency.setTargetAtTime(base * 1.5, now, 0.08);
      engine.oscillators[2].frequency.setTargetAtTime(base * 2.01, now, 0.08);
      engine.filter.frequency.setTargetAtTime(360 + rpm * 1500, now, 0.1);
      engine.gain.gain.setTargetAtTime(muted ? 0 : 0.1 + rpm * 0.3, now, 0.12);
      if (nodes.tremolo) nodes.tremolo.frequency.setTargetAtTime(6 + rpm * 34, now, 0.1);

      const windLevel = Math.min(0.34, Math.pow(Math.max(0, speed - 8) / 110, 1.7) * 0.5);
      wind.gain.gain.setTargetAtTime(muted ? 0 : windLevel, now, 0.15);
      wind.filter.frequency.setTargetAtTime(300 + speed * 9, now, 0.15);
    },
    /** The stall horn, which sounds while the wing is about to let go. */
    stall(level) {
      if (!context || muted) return;
      if (!nodes.stallOscillator) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'square';
        oscillator.frequency.value = 720;
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(master);
        oscillator.start();
        nodes.stallOscillator = oscillator;
        nodes.stallGain = gain;
      }
      nodes.stallGain.gain.setTargetAtTime(level > 0.55 ? 0.07 : 0, context.currentTime, 0.05);
    },
    /** The chime that says a ring was flown through. */
    ringChime() {
      beep(1180, 0.16, 'triangle', 0.28);
      window.setTimeout(() => beep(1760, 0.22, 'triangle', 0.22), 90);
    },
    /** The warning that the clock is nearly out. */
    timeWarning() {
      beep(520, 0.12, 'square', 0.2);
    },
    /** The sound of the wheels touching down. */
    touchdown(strength = 0.5) {
      burst(0.25 + strength * 0.5, 0.28, 700);
    },
    /** The sound of a crash. */
    crash() {
      burst(0.8, 0.9, 1800);
      beep(90, 0.7, 'sawtooth', 0.35);
    },
    /** The sound of the mission's end. */
    fanfare() {
      [523, 659, 784, 1047].forEach((frequency, index) => {
        window.setTimeout(() => beep(frequency, 0.35, 'triangle', 0.26), index * 130);
      });
    },
    /** Turns the sound off or on. */
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 0.55;
    },
    get isMuted() {
      return muted;
    },
  };
}
