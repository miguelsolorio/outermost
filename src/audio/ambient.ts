// Procedural ambient soundscape (Web Audio). Four slowly evolving layers
// crossfade with the scale of the view:
//   planet  – a warm, filtered drone with a breath of wind (near a world)
//   system  – deep open fifths (interplanetary space)
//   stars   – sparse high partials that shimmer in and out (among the stars)
//   cosmos  – a very low swell under a soft hiss (galaxies and beyond)
// Nothing here is a recording or data sonification; it's mood only.
// Browsers only allow audio after a user gesture, so it starts on the first
// interaction and can be muted from the HUD.

type LayerName = 'planet' | 'system' | 'stars' | 'cosmos';

const log10 = (x: number) => Math.log(x) / Math.LN10;
const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Ambient {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers = new Map<LayerName, GainNode>();
  private enabled = true;
  private started = false;
  /** Layer weights from the view scale, smoothed. */
  private weights: Record<LayerName, number> = { planet: 0, system: 0, stars: 0, cosmos: 0 };

  constructor(private volume = 0.5) {
    try {
      this.enabled = localStorage.getItem('ambient-muted') !== '1';
    } catch {
      this.enabled = true;
    }
    const start = () => {
      if (this.enabled) this.start();
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else if (this.enabled) void this.ctx.resume();
    });
  }

  get on(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem('ambient-muted', on ? '0' : '1');
    } catch {
      // storage unavailable
    }
    if (on && !this.started) this.start();
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? this.volume : 0, t, 0.4);
    if (on) void this.ctx.resume();
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.gain.setTargetAtTime(this.volume, ctx.currentTime, 2.5);
    this.master.connect(comp);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(ctx, 7, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    reverb.connect(wet).connect(this.master);
    const dry = ctx.createGain();
    dry.gain.value = 0.6;
    dry.connect(this.master);
    const bus = (name: LayerName): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(dry);
      g.connect(reverb);
      this.layers.set(name, g);
      return g;
    };

    this.buildPlanet(ctx, bus('planet'));
    this.buildSystem(ctx, bus('system'));
    this.buildStars(ctx, bus('stars'));
    this.buildCosmos(ctx, bus('cosmos'));
  }

  /** Update from the camera's distance to what it looks at (m) and the distance from the Sun (m). */
  update(viewScale: number, fromSun: number): void {
    if (!this.ctx || !this.started) return;
    const s = log10(Math.max(viewScale, 1));
    const d = log10(Math.max(fromSun, 1));
    const target: Record<LayerName, number> = {
      planet: 1 - smooth(s, 8.3, 9.3),
      system: smooth(s, 8.3, 9.3) * (1 - smooth(d, 14.3, 15.5)),
      stars: smooth(d, 14.3, 15.5) * (1 - smooth(d, 19.6, 20.6)),
      cosmos: smooth(d, 19.6, 20.6),
    };
    const t = this.ctx.currentTime;
    for (const [name, g] of this.layers) {
      const w = target[name];
      if (Math.abs(w - this.weights[name]) < 0.01) continue;
      this.weights[name] = w;
      g.gain.setTargetAtTime(w, t, 1.2);
    }
  }

  // ---- layers ----------------------------------------------------------------

  private buildPlanet(ctx: AudioContext, out: GainNode): void {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    lp.connect(g).connect(out);
    // A1 and E2, each a slightly detuned pair of saws.
    for (const [f, det] of [
      [55, -6],
      [55, 5],
      [82.41, -4],
      [82.41, 7],
      [110, 3],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = f > 100 ? 0.25 : 0.5;
      o.connect(og).connect(lp);
      o.start();
    }
    this.lfo(ctx, lp.frequency, 0.021, 140);
    // Wind: brown noise through a wandering band-pass.
    const noise = this.noise(ctx, 'brown');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.value = 0.18;
    noise.connect(bp).connect(ng).connect(out);
    this.lfo(ctx, bp.frequency, 0.047, 260);
    this.lfo(ctx, ng.gain, 0.031, 0.1);
  }

  private buildSystem(ctx: AudioContext, out: GainNode): void {
    const g = ctx.createGain();
    g.gain.value = 0.22;
    g.connect(out);
    // E1-B1-E2-B2: open fifths, sine and triangle, slowly breathing.
    [41.2, 61.74, 82.41, 123.47, 164.81].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0.3 / (1 + i * 0.4);
      o.connect(og).connect(g);
      o.start();
      this.lfo(ctx, og.gain, 0.013 + i * 0.007, og.gain.value * 0.7);
    });
  }

  private buildStars(ctx: AudioContext, out: GainNode): void {
    const g = ctx.createGain();
    g.gain.value = 0.07;
    g.connect(out);
    // E major pentatonic partials drifting in and out at unrelated rates.
    [659.25, 830.61, 987.77, 1108.73, 1318.51, 1661.22, 1975.53, 2217.46].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = 0;
      o.connect(og).connect(g);
      o.start();
      // Mostly silent, occasionally swelling (a half-wave rectified LFO).
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + ((i * 0.37) % 1) * 0.06;
      const shaper = ctx.createWaveShaper();
      shaper.curve = Float32Array.from({ length: 256 }, (_, k) => Math.max(0, (k / 127.5 - 1) * 1.6 - 0.6));
      const depth = ctx.createGain();
      depth.gain.value = 0.35;
      lfo.connect(shaper).connect(depth).connect(og.gain);
      lfo.start(ctx.currentTime + i * 1.7);
    });
    // A faint low bed so it doesn't feel empty.
    const o = ctx.createOscillator();
    o.frequency.value = 82.41;
    const og = ctx.createGain();
    og.gain.value = 0.8;
    o.connect(og).connect(g);
    o.start();
  }

  private buildCosmos(ctx: AudioContext, out: GainNode): void {
    const g = ctx.createGain();
    g.gain.value = 0.25;
    g.connect(out);
    for (const [f, a] of [
      [36.71, 0.5],
      [55, 0.35],
      [73.42, 0.2],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start();
      this.lfo(ctx, og.gain, 0.008 + f * 0.0001, a * 0.8);
    }
    // Soft hiss, like tuning between stations: a nod to the CMB's radio static.
    const noise = this.noise(ctx, 'pink');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(hp).connect(lp).connect(ng).connect(g);
    this.lfo(ctx, ng.gain, 0.019, 0.03);
  }

  // ---- helpers ---------------------------------------------------------------

  private lfo(ctx: AudioContext, param: AudioParam, hz: number, depth: number): void {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(param);
    o.start(ctx.currentTime + Math.random() * 5);
  }

  private noise(ctx: AudioContext, color: 'pink' | 'brown'): AudioBufferSourceNode {
    const len = ctx.sampleRate * 8;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.12;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start();
    return src;
  }

  /** Exponentially decaying stereo noise: a large, dark hall. */
  private impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.7 + (Math.random() * 2 - 1) * 0.3;
        d[i] = lp * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }
}
