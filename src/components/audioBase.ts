// Shared Web Audio plumbing for synthesized vehicle sounds: output chain with
// a small room reverb and compressor, mute, one-shot helpers and crash thuds.

const MASTER_VOLUME = 0.7;

function createNoiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Short, dark stereo impulse response: a small room with soft furnishings.
function createRoomImpulse(ctx: BaseAudioContext, seconds: number) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      smooth = smooth * 0.6 + (Math.random() * 2 - 1) * 0.4;
      data[i] = smooth * Math.pow(1 - i / length, 3);
    }
  }
  return buffer;
}

export class SynthAudio {
  protected ctx: AudioContext;
  protected noise: AudioBuffer;
  // Everything audible connects here: bus -> (dry + reverb) -> compressor.
  protected bus: GainNode;
  // Looping sources started on the first user gesture.
  protected sources: AudioScheduledSourceNode[] = [];
  protected lastUpdate = 0;

  private master: GainNode;
  private started = false;
  private muted = false;
  private lastBump = 0;

  constructor() {
    this.ctx = new AudioContext();
    const ctx = this.ctx;
    this.noise = createNoiseBuffer(ctx, 2);

    this.master = ctx.createGain();
    this.master.gain.value = MASTER_VOLUME;
    this.master.connect(ctx.destination);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.15;
    compressor.connect(this.master);

    this.bus = ctx.createGain();
    this.bus.connect(compressor);

    const reverb = ctx.createConvolver();
    reverb.buffer = createRoomImpulse(ctx, 0.9);
    const reverbWet = ctx.createGain();
    reverbWet.gain.value = 0.18;
    this.bus.connect(reverb).connect(reverbWet).connect(compressor);
  }

  get isStarted() {
    return this.started;
  }

  // Must be called from a user gesture (browsers block autoplay).
  start() {
    if (!this.started) {
      this.started = true;
      for (const source of this.sources) source.start();
      this.lastUpdate = this.ctx.currentTime;
    }
    void this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : MASTER_VOLUME,
      this.ctx.currentTime,
      0.05,
    );
  }

  // Seconds since the previous call, capped so tab switches don't jump.
  protected tick() {
    const now = this.ctx.currentTime;
    const dt = Math.min(Math.max(now - this.lastUpdate, 0), 0.1);
    this.lastUpdate = now;
    return { now, dt };
  }

  protected createLoopingNoise() {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    this.sources.push(source);
    return source;
  }

  // Burst of noise through a filter with a fast decay envelope.
  protected playNoiseBurst(
    at: number,
    type: BiquadFilterType,
    frequency: number,
    volume: number,
    decay: number,
  ) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + decay);
    source.connect(filter).connect(gain).connect(this.bus);
    source.start(at, Math.random());
    source.stop(at + decay + 0.02);
    return filter;
  }

  protected playThump(
    at: number,
    from: number,
    to: number,
    volume: number,
    decay: number,
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + decay);
    osc.connect(gain).connect(this.bus);
    osc.start(at);
    osc.stop(at + decay + 0.02);
  }

  // One-shot crash thud; `strength` is the impact speed (world units/s).
  bump(strength: number) {
    if (!this.started) return;
    const now = this.ctx.currentTime;
    if (now - this.lastBump < 0.15) return;
    this.lastBump = now;
    const volume = Math.min(strength / 3, 1) * 0.55;
    this.playThump(now, 120, 38, volume, 0.28);
    this.playNoiseBurst(now, "lowpass", 1100, volume * 0.7, 0.14);
    this.playNoiseBurst(now + 0.01, "bandpass", 3200, volume * 0.25, 0.08);
  }

  dispose() {
    void this.ctx.close();
  }
}
