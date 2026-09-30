// Synthesized hover-ship sounds: a detuned sci-fi hum that climbs with speed,
// a thruster roar, a whine when rising/falling and an afterburner on boost.

import { SynthAudio } from "./audioBase";

type ShipSoundState = {
  speed: number; // 0..1 of top speed
  thrust: boolean;
  climb: number; // -1..1
  boost: boolean;
};

export class ShipAudio extends SynthAudio {
  private humLow: OscillatorNode;
  private humHigh: OscillatorNode;
  private humFilter: BiquadFilterNode;
  private humGain: GainNode;
  private thrusterFilter: BiquadFilterNode;
  private thrusterGain: GainNode;
  private lift: OscillatorNode;
  private liftGain: GainNode;
  private burnerGain: GainNode;
  private wasBoost = false;

  constructor() {
    super();
    const ctx = this.ctx;

    // Hum: two detuned oscillators with a slow shimmer, through a lowpass.
    this.humFilter = ctx.createBiquadFilter();
    this.humFilter.type = "lowpass";
    this.humFilter.Q.value = 6;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humFilter.connect(this.humGain).connect(this.bus);

    this.humLow = ctx.createOscillator();
    this.humLow.type = "sawtooth";
    this.humHigh = ctx.createOscillator();
    this.humHigh.type = "square";
    this.humHigh.detune.value = 7;
    const highLevel = ctx.createGain();
    highLevel.gain.value = 0.35;
    this.humLow.connect(this.humFilter);
    this.humHigh.connect(highLevel).connect(this.humFilter);

    const shimmer = ctx.createOscillator();
    shimmer.frequency.value = 0.8;
    const shimmerDepth = ctx.createGain();
    shimmerDepth.gain.value = 180;
    shimmer.connect(shimmerDepth).connect(this.humFilter.frequency);

    // Thruster: filtered noise that opens up with speed.
    this.thrusterFilter = ctx.createBiquadFilter();
    this.thrusterFilter.type = "bandpass";
    this.thrusterFilter.Q.value = 0.9;
    this.thrusterGain = ctx.createGain();
    this.thrusterGain.gain.value = 0;
    this.createLoopingNoise()
      .connect(this.thrusterFilter)
      .connect(this.thrusterGain)
      .connect(this.bus);

    // Lift whine: a soft triangle that bends with climb rate.
    this.lift = ctx.createOscillator();
    this.lift.type = "triangle";
    this.liftGain = ctx.createGain();
    this.liftGain.gain.value = 0;
    this.lift.connect(this.liftGain).connect(this.bus);

    // Afterburner: low rumbling noise, only while boosting.
    const burnerFilter = ctx.createBiquadFilter();
    burnerFilter.type = "lowpass";
    burnerFilter.frequency.value = 380;
    this.burnerGain = ctx.createGain();
    this.burnerGain.gain.value = 0;
    this.createLoopingNoise()
      .connect(burnerFilter)
      .connect(this.burnerGain)
      .connect(this.bus);

    this.sources.push(this.humLow, this.humHigh, shimmer, this.lift);
  }

  update({ speed, thrust, climb, boost }: ShipSoundState) {
    if (!this.isStarted) return;
    const { now } = this.tick();
    const drive = speed + (thrust ? 0.15 : 0) + (boost ? 0.25 : 0);

    const pitch = 70 + drive * 90;
    this.humLow.frequency.setTargetAtTime(pitch, now, 0.12);
    this.humHigh.frequency.setTargetAtTime(pitch * 2.01, now, 0.12);
    this.humFilter.frequency.setTargetAtTime(500 + drive * 1800, now, 0.1);
    this.humGain.gain.setTargetAtTime(0.07 + drive * 0.05, now, 0.1);

    this.thrusterFilter.frequency.setTargetAtTime(300 + speed * 1600, now, 0.1);
    this.thrusterGain.gain.setTargetAtTime(
      speed * 0.12 + (thrust ? 0.04 : 0),
      now,
      0.08,
    );

    this.lift.frequency.setTargetAtTime(320 + climb * 160, now, 0.1);
    this.liftGain.gain.setTargetAtTime(Math.abs(climb) * 0.035, now, 0.08);

    const burning = boost && thrust;
    this.burnerGain.gain.setTargetAtTime(burning ? 0.22 : 0, now, burning ? 0.08 : 0.2);
    if (burning && !this.wasBoost) {
      // Ignition "whump".
      this.playThump(now, 70, 35, 0.25, 0.3);
    }
    this.wasBoost = burning;
  }
}
