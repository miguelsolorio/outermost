// Cockpit foley (Web Audio, all synthesized): the clicks, ticks and clunks of
// the console's switches, knobs and levers, and an engine hum that rises with
// the ship's drift. It plays through the ambient soundscape's master bus, so
// it mutes with the sound toggle and fades out when the page is hidden.
// Nothing here is a recording.

import type { Ambient } from './ambient.ts';

export type Sfx = 'key' | 'clack' | 'tick' | 'clunk' | 'thunk' | 'cover' | 'servo' | 'engage' | 'eject';

/** The hum's voice for a drift (pace units per second): a quiet idle that deepens and brightens with speed. */
export function humParams(drift: number): { gain: number; pitch: number; cutoff: number; rush: number } {
  const k = Math.min(1, Math.log1p(Math.abs(drift)) / Math.log1p(5));
  return { gain: 0.05 + 0.1 * k, pitch: 1 + 0.6 * k, cutoff: 140 + 900 * k, rush: 0.1 * k * k };
}

interface Hum {
  voices: OscillatorNode[];
  sub: OscillatorNode;
  noise: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  rush: GainNode;
}

export class Foley {
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<Sfx, number>();
  private hum: Hum | null = null;

  constructor(private ambient: Ambient) {}

  /** Play a control's sound (from a user's press, so it may start the audio). */
  play(name: Sfx): void {
    if (!this.ambient.on) return;
    const bus = this.ambient.bus(true);
    if (!bus) return;
    const { ctx, out } = bus;
    const t = ctx.currentTime + 0.005;
    const prev = this.last.get(name) ?? -Infinity;
    if (t - prev < (name === 'tick' ? 0.03 : 0.012)) return;
    this.last.set(name, t);
    const jitter = 1 + (Math.random() - 0.5) * 0.12;
    switch (name) {
      case 'key':
        this.burst(ctx, out, t, 0.006, 'bandpass', 3200 * jitter, 1.2, 0.5);
        this.tone(ctx, out, t, 1900, 1400, 0.02, 0.05, 'square');
        break;
      case 'clack':
        this.burst(ctx, out, t, 0.008, 'bandpass', 2200 * jitter, 0.9, 0.7);
        this.tone(ctx, out, t, 150, 90, 0.07, 0.35);
        this.burst(ctx, out, t + 0.022, 0.005, 'bandpass', 2600, 1, 0.25);
        break;
      case 'tick':
        this.burst(ctx, out, t, 0.003, 'highpass', 4000 * jitter, 0.7, 0.35);
        break;
      case 'clunk':
      case 'thunk': {
        const k = name === 'thunk' ? 1.35 : 1;
        this.tone(ctx, out, t, 95 / k, 55 / k, 0.2 * k, 0.45 * k);
        this.burst(ctx, out, t, 0.05, 'lowpass', 900, 0.7, 0.4 * k);
        this.tone(ctx, out, t, 523, 520, 0.25, 0.025);
        this.tone(ctx, out, t, 791, 786, 0.2, 0.018);
        break;
      }
      case 'cover':
        this.burst(ctx, out, t, 0.004, 'bandpass', 2800 * jitter, 1, 0.4);
        this.tone(ctx, out, t + 0.01, 330, 300, 0.14, 0.07, 'triangle');
        break;
      case 'servo': {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(180, t);
        o.frequency.exponentialRampToValueAtTime(250, t + 0.35);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        const g = this.env(ctx, t, 0.04, 0.05, 0.4);
        o.connect(lp).connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.5);
        break;
      }
      case 'engage': {
        this.tone(ctx, out, t, 95, 50, 0.25, 0.5);
        this.tone(ctx, out, t, 45, 40, 0.9, 0.35);
        const src = this.noise(ctx);
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(200, t);
        bp.frequency.exponentialRampToValueAtTime(2500, t + 0.8);
        const g = this.env(ctx, t, 0.25, 0.25, 0.9);
        src.connect(bp).connect(g).connect(out);
        src.start(t);
        src.stop(t + 1);
        break;
      }
      case 'eject':
        this.tone(ctx, out, t, 880, 880, 0.08, 0.06, 'square');
        this.tone(ctx, out, t + 0.1, 660, 660, 0.1, 0.06, 'square');
        this.burst(ctx, out, t + 0.05, 0.5, 'highpass', 3000, 0.7, 0.2);
        break;
    }
  }

  /**
   * Keep the engine hum going (or not) for a drift (pace units per second).
   * Called about ten times a second; it never starts the audio itself.
   */
  engine(active: boolean, drift: number): void {
    const bus = this.ambient.on ? this.ambient.bus(false) : null;
    if (!active || !bus) {
      this.stopHum();
      return;
    }
    const { ctx, out } = bus;
    const h = (this.hum ??= this.buildHum(ctx, out));
    const p = humParams(drift);
    const t = ctx.currentTime;
    h.gain.gain.setTargetAtTime(p.gain, t, 0.3);
    h.rush.gain.setTargetAtTime(p.rush, t, 0.3);
    h.filter.frequency.setTargetAtTime(p.cutoff, t, 0.3);
    h.voices[0].frequency.setTargetAtTime(42 * p.pitch, t, 0.3);
    h.voices[1].frequency.setTargetAtTime(42.35 * p.pitch, t, 0.3);
    h.sub.frequency.setTargetAtTime(21 * p.pitch, t, 0.3);
  }

  private buildHum(ctx: AudioContext, out: AudioNode): Hum {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(out);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.value = 140;
    filter.connect(gain);
    const voices = [42, 42.35].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start();
      return o;
    });
    const sub = ctx.createOscillator();
    sub.frequency.value = 21;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.8;
    sub.connect(subGain).connect(gain);
    sub.start();
    const noise = this.noise(ctx);
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 800;
    bp.Q.value = 0.7;
    const rush = ctx.createGain();
    rush.gain.value = 0;
    noise.connect(bp).connect(rush).connect(out);
    noise.start();
    return { voices, sub, noise, filter, gain, rush };
  }

  private stopHum(): void {
    const h = this.hum;
    if (!h) return;
    this.hum = null;
    const ctx = h.gain.context;
    const t = ctx.currentTime;
    h.gain.gain.setTargetAtTime(0, t, 0.15);
    h.rush.gain.setTargetAtTime(0, t, 0.15);
    for (const o of [...h.voices, h.sub, h.noise]) o.stop(t + 0.8);
  }

  private noise(ctx: BaseAudioContext): AudioBufferSourceNode {
    if (!this.noiseBuf) {
      const n = ctx.sampleRate;
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    return src;
  }

  /** A gain that rises in `attack` s to `peak` and dies away over `decay` s. */
  private env(ctx: BaseAudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + Math.max(attack, 0.001));
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  /** A filtered noise burst. */
  private burst(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number): void {
    const src = this.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.env(ctx, t, peak, 0.001, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** A pitched blip gliding from f0 to f1. */
  private tone(ctx: BaseAudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType = 'sine'): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.env(ctx, t, peak, 0.002, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
}
