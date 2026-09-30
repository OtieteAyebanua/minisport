// Synthesized skateboard sounds: rolling wheels, kick-push scrapes, ollie
// tail snap and landing clack.

import { SynthAudio } from "./audioBase";

export class CharacterAudio extends SynthAudio {
  private rollFilter: BiquadFilterNode;
  private rollGain: GainNode;
  private clack: GainNode;
  private clackTone: OscillatorNode;

  constructor() {
    super();
    const ctx = this.ctx;

    // Wheels: low rumble whose brightness rises with speed, plus a faint
    // rhythmic "clack" as the wheels roll over floor seams.
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = "lowpass";
    this.rollFilter.Q.value = 2;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.createLoopingNoise().connect(this.rollFilter).connect(this.rollGain).connect(this.bus);

    this.clack = ctx.createGain();
    this.clack.gain.value = 0;
    const clackTone = ctx.createOscillator();
    clackTone.type = "square";
    clackTone.frequency.value = 3;
    const clackFilter = ctx.createBiquadFilter();
    clackFilter.type = "bandpass";
    clackFilter.frequency.value = 180;
    clackTone.connect(clackFilter).connect(this.clack).connect(this.bus);
    this.sources.push(clackTone);
    this.clackTone = clackTone;
  }

  // `speed` is 0..1 of top speed.
  update(speed: number, grounded: boolean) {
    if (!this.isStarted) return;
    const { now } = this.tick();
    const rolling = grounded ? speed : 0;
    this.rollFilter.frequency.setTargetAtTime(180 + rolling * 900, now, 0.08);
    this.rollGain.gain.setTargetAtTime(Math.min(rolling * 3, 1) * (0.1 + rolling * 0.12), now, 0.06);
    this.clackTone.frequency.setTargetAtTime(1.5 + rolling * 10, now, 0.1);
    this.clack.gain.setTargetAtTime(rolling * 0.04, now, 0.1);
  }

  // Back foot scraping the floor on a kick-push.
  push(hard: boolean) {
    if (!this.isStarted) return;
    const now = this.ctx.currentTime;
    const volume = (hard ? 0.16 : 0.11) * (0.85 + Math.random() * 0.3);
    const filter = this.playNoiseBurst(now, "bandpass", 1200, volume, 0.16);
    filter.frequency.setValueAtTime(1600, now);
    filter.frequency.exponentialRampToValueAtTime(700, now + 0.15);
    this.playThump(now, 110, 60, volume * 0.6, 0.06);
  }

  // Ollie: the tail snapping against the floor.
  jump() {
    if (!this.isStarted) return;
    const now = this.ctx.currentTime;
    this.playThump(now, 420, 160, 0.22, 0.05);
    this.playNoiseBurst(now, "highpass", 2500, 0.14, 0.04);
  }

  // Landing: wheels and deck hitting the floor. `strength` is the downward
  // speed at touchdown (world units/s).
  land(strength: number) {
    if (!this.isStarted) return;
    const now = this.ctx.currentTime;
    const volume = Math.min(strength, 1.5) * 0.25;
    this.playThump(now, 150, 50, volume, 0.14);
    this.playNoiseBurst(now, "bandpass", 900, volume * 0.8, 0.08);
    this.playNoiseBurst(now + 0.015, "highpass", 3000, volume * 0.3, 0.03);
  }
}
