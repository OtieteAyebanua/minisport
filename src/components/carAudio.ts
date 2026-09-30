// Synthesized car sounds (no audio files). The engine is driven by a simple
// RPM + gearbox model so it revs, shifts, crackles and whistles like a
// racing-game car, plus tyre squeal. Crash thuds and reverb live in SynthAudio.

import { SynthAudio } from "./audioBase";

type CarSoundState = {
  speed: number; // 0..1 of top speed
  throttle: boolean;
  boost: boolean;
  reverse: boolean;
  skid: number; // 0..1 sideways slide / hard braking
};

// Engine model.
const IDLE_RPM = 850;
const REDLINE_RPM = 7200;
const SHIFT_LANDING_RPM = 3800; // where the revs drop to after an upshift
const CYLINDERS = 4;
// Upshift points as a fraction of top speed (gears 1 -> 5).
const UPSHIFTS = [0.2, 0.38, 0.56, 0.76];
const DOWNSHIFT_GAP = 0.06;

// Soft-clipping curve that adds grit when the engine is driven harder.
function createDriveCurve(amount: number) {
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

// Combustion-pulse spectrum: strong low harmonics, uneven falloff for bite.
function createEngineWave(ctx: BaseAudioContext) {
  const harmonics = 32;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) {
    const falloff = 1 / Math.pow(n, 1.1);
    const character = n % 2 === 0 ? 0.75 : 1;
    const bump = n === 3 || n === 5 ? 1.4 : 1;
    imag[n] = falloff * character * bump;
    real[n] = falloff * 0.25 * Math.sin(n * 1.7);
  }
  return ctx.createPeriodicWave(real, imag);
}

export class CarAudio extends SynthAudio {
  // Engine voice.
  private firing: OscillatorNode;
  private sub: OscillatorNode;
  private pulse: OscillatorNode;
  private roughFilter: BiquadFilterNode;
  private roughLevel: GainNode;
  private drive: GainNode;
  private tone: BiquadFilterNode;
  private engineGain: GainNode;

  // Turbo whistle.
  private turbo: OscillatorNode;
  private turboGain: GainNode;

  // Tyres.
  private skidGain: GainNode;

  // Engine model state.
  private rpm = IDLE_RPM;
  private gear = 0;
  private load = 0;
  private shiftUntil = 0;
  private wasThrottle = false;
  private wasBoost = false;

  constructor() {
    super();
    const ctx = this.ctx;

    // Engine: firing-rate tone + half-rate crank rumble + pulsed exhaust
    // noise, driven into a soft clipper, then a load-dependent lowpass.
    this.drive = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    shaper.curve = createDriveCurve(3);
    shaper.oversample = "4x";
    this.tone = ctx.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.Q.value = 1.5;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.drive.connect(shaper).connect(this.tone).connect(this.engineGain).connect(this.bus);

    this.firing = ctx.createOscillator();
    this.firing.setPeriodicWave(createEngineWave(ctx));
    const firingLevel = ctx.createGain();
    firingLevel.gain.value = 0.55;
    this.firing.connect(firingLevel).connect(this.drive);

    this.sub = ctx.createOscillator();
    this.sub.type = "triangle";
    const subLevel = ctx.createGain();
    subLevel.gain.value = 0.45;
    this.sub.connect(subLevel).connect(this.drive);

    // Exhaust roughness: bandpassed noise amplitude-modulated at firing rate.
    const exhaust = this.createLoopingNoise();
    this.roughFilter = ctx.createBiquadFilter();
    this.roughFilter.type = "bandpass";
    this.roughFilter.Q.value = 0.8;
    const pulsed = ctx.createGain();
    pulsed.gain.value = 0.5;
    this.pulse = ctx.createOscillator();
    this.pulse.type = "square";
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    this.pulse.connect(pulseDepth).connect(pulsed.gain);
    this.roughLevel = ctx.createGain();
    exhaust.connect(this.roughFilter).connect(pulsed).connect(this.roughLevel).connect(this.drive);

    // Slight RPM wobble so the idle isn't perfectly steady.
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 5.3;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 9; // cents
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(this.firing.detune);
    wobbleDepth.connect(this.sub.detune);

    // Turbo whistle, only audible while boosting.
    this.turbo = ctx.createOscillator();
    this.turbo.type = "sine";
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.bus);

    // Tyre squeal: noise through a resonant bandpass whose pitch wavers.
    const skidSource = this.createLoopingNoise();
    const skidFilter = ctx.createBiquadFilter();
    skidFilter.type = "bandpass";
    skidFilter.frequency.value = 1900;
    skidFilter.Q.value = 12;
    const skidWaver = ctx.createOscillator();
    skidWaver.frequency.value = 7;
    const skidWaverDepth = ctx.createGain();
    skidWaverDepth.gain.value = 250;
    skidWaver.connect(skidWaverDepth).connect(skidFilter.frequency);
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    skidSource.connect(skidFilter).connect(this.skidGain).connect(this.bus);

    this.sources.push(this.firing, this.sub, this.pulse, wobble, this.turbo, skidWaver);
  }

  get engine() {
    return { rpm: this.isStarted ? this.rpm : 0, gear: this.gear };
  }

  update({ speed, throttle, boost, reverse, skid }: CarSoundState) {
    if (!this.isStarted) return;
    const { now, dt } = this.tick();

    // --- Gearbox: pick a gear from road speed, with hysteresis.
    let shifted = false;
    if (reverse) {
      this.gear = 0;
    } else {
      while (this.gear < UPSHIFTS.length && speed > UPSHIFTS[this.gear]) {
        this.gear++;
        shifted = true;
      }
      while (this.gear > 0 && speed < UPSHIFTS[this.gear - 1] - DOWNSHIFT_GAP) {
        this.gear--;
      }
    }

    // --- RPM: position within the current gear's speed band.
    const gearLow = this.gear === 0 ? 0 : UPSHIFTS[this.gear - 1];
    const gearHigh = UPSHIFTS[this.gear] ?? 1;
    const bandSpeed = reverse ? Math.min(speed * 3, 1) : speed;
    const withinGear = Math.min(Math.max((bandSpeed - gearLow) / (gearHigh - gearLow), 0), 1);
    const floor = this.gear === 0 ? IDLE_RPM : SHIFT_LANDING_RPM;
    let targetRpm = floor + withinGear * (REDLINE_RPM - floor);
    if (throttle) targetRpm = Math.max(targetRpm, 2600); // revs up when launching or stuck
    if (boost) targetRpm += 400;
    targetRpm = Math.min(targetRpm, REDLINE_RPM + 300);

    if (shifted) {
      // Revs fall to the landing RPM and power briefly cuts out.
      this.rpm = Math.min(this.rpm, SHIFT_LANDING_RPM + 300);
      this.shiftUntil = now + 0.11;
      this.engineGain.gain.cancelScheduledValues(now);
      this.engineGain.gain.setTargetAtTime(0.06, now, 0.015);
      this.playShiftClunk();
    }
    const rpmRate = targetRpm > this.rpm ? (throttle ? 5 : 3) : 4;
    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-rpmRate * dt));
    this.rpm += (Math.random() - 0.5) * 25; // combustion jitter

    this.load += ((throttle ? 1 : 0) - this.load) * (1 - Math.exp(-8 * dt));
    const rev = (this.rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM);

    // --- Engine voice.
    const firingHz = (this.rpm / 60) * (CYLINDERS / 2);
    this.firing.frequency.setTargetAtTime(firingHz, now, 0.03);
    this.sub.frequency.setTargetAtTime(firingHz / 2, now, 0.03);
    this.pulse.frequency.setTargetAtTime(firingHz, now, 0.03);
    this.roughFilter.frequency.setTargetAtTime(400 + firingHz * 5, now, 0.05);
    this.roughLevel.gain.setTargetAtTime(0.25 + this.load * 0.45, now, 0.05);
    this.drive.gain.setTargetAtTime(0.6 + this.load * 1.4 + rev * 0.4, now, 0.05);
    this.tone.frequency.setTargetAtTime(
      500 + rev * 1800 + this.load * 1600 + (boost ? 800 : 0),
      now,
      0.05,
    );
    if (now >= this.shiftUntil) {
      this.engineGain.gain.setTargetAtTime(
        0.13 + rev * 0.07 + this.load * 0.08,
        now,
        0.04,
      );
    }

    // --- Backfire crackle when lifting off at high revs.
    if (this.wasThrottle && !throttle && this.rpm > 4300) {
      const pops = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < pops; i++) {
        this.playPop(now + 0.04 + i * (0.05 + Math.random() * 0.08));
      }
    }
    this.wasThrottle = throttle;

    // --- Turbo whistle / blow-off.
    const spool = boost && throttle ? 1 : 0;
    this.turbo.frequency.setTargetAtTime(2200 + rev * 1800, now, 0.2);
    this.turboGain.gain.setTargetAtTime(spool * 0.025, now, spool ? 0.25 : 0.05);
    if (this.wasBoost && !spool && this.rpm > 3000) this.playBlowOff(now);
    this.wasBoost = spool === 1;

    // --- Tyres.
    this.skidGain.gain.setTargetAtTime(
      Math.min(skid, 1) * 0.14 * Math.min(speed * 3, 1),
      now,
      0.06,
    );
  }

  private playPop(at: number) {
    const volume = 0.12 + Math.random() * 0.12;
    this.playThump(at, 180 + Math.random() * 80, 50, volume, 0.06);
    this.playNoiseBurst(at, "bandpass", 700 + Math.random() * 900, volume * 1.4, 0.05);
  }

  private playShiftClunk() {
    const now = this.ctx.currentTime;
    this.playThump(now, 90, 45, 0.08, 0.07);
  }

  private playBlowOff(at: number) {
    const filter = this.playNoiseBurst(at, "highpass", 2500, 0.07, 0.35);
    filter.frequency.setValueAtTime(2500, at);
    filter.frequency.exponentialRampToValueAtTime(5000, at + 0.3);
  }
}
