// Procedural ambient soundscape (Web Audio). Four slowly evolving layers
// crossfade with the scale of the view:
//   planet  – a warm, filtered drone with a breath of wind (near a world)
//   system  – deep open fifths (interplanetary space)
//   stars   – sparse high partials that shimmer in and out (among the stars)
//   cosmos  – a very low swell under a soft hiss (galaxies and beyond)
// Nothing here is a recording or data sonification; it's mood only.
// Browsers only allow audio after a user gesture, so it starts on the first
// interaction and can be muted from the HUD. It fades out and pauses whenever
// the page is hidden or the window loses focus, and fades back in on return.
// The same graph can also be rendered offline along a recorded camera path,
// which is how the demo video (tools/demo) gets its soundtrack.

type LayerName = 'planet' | 'system' | 'stars' | 'cosmos';
type Weights = Record<LayerName, number>;

/** One camera sample for an offline render: seconds from the start, and the arguments `update` would get. */
export interface AmbientSample {
  t: number;
  viewScale: number;
  fromSun: number;
}

interface Graph {
  master: GainNode;
  layers: Map<LayerName, GainNode>;
  /** Layer weights last scheduled, so small changes don't pile up automation. */
  weights: Weights;
}

const log10 = (x: number) => Math.log(x) / Math.LN10;
const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Layer mix for the camera's distance to what it looks at (m) and its distance from the Sun (m). */
export function layerWeights(viewScale: number, fromSun: number): Weights {
  const s = log10(Math.max(viewScale, 1));
  const d = log10(Math.max(fromSun, 1));
  return {
    planet: 1 - smooth(s, 8.3, 9.3),
    system: smooth(s, 8.3, 9.3) * (1 - smooth(d, 14.3, 15.5)),
    stars: smooth(d, 14.3, 15.5) * (1 - smooth(d, 19.6, 20.6)),
    cosmos: smooth(d, 19.6, 20.6),
  };
}

export class Ambient {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private enabled = true;
  private started = false;
  private suspendTimer = 0;

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
    const sync = () => this.syncActive();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('blur', sync);
    window.addEventListener('focus', sync);
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
    if (!this.ctx || !this.graph) return;
    const t = this.ctx.currentTime;
    const master = this.graph.master;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(on && this.pageActive() ? this.volume : 0, t, 0.4);
    if (on) this.syncActive();
  }

  private pageActive(): boolean {
    return !document.hidden && document.hasFocus();
  }

  /** Fade out and suspend while the page is hidden or unfocused; resume and fade back in when it returns. */
  private syncActive(): void {
    const ctx = this.ctx;
    const master = this.graph?.master;
    if (!ctx || !master) return;
    clearTimeout(this.suspendTimer);
    master.gain.cancelScheduledValues(ctx.currentTime);
    if (this.pageActive()) {
      if (!this.enabled) return;
      void ctx.resume().then(() => master.gain.setTargetAtTime(this.volume, ctx.currentTime, 0.4));
    } else {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
      // A hidden tab may throttle timers, but suspending late is harmless: it's already silent.
      this.suspendTimer = window.setTimeout(() => void ctx.suspend(), 500);
    }
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.graph = buildGraph(ctx, Math.random);
    this.graph.master.gain.setTargetAtTime(this.volume, ctx.currentTime, 2.5);
  }

  /** Update from the camera's distance to what it looks at (m) and the distance from the Sun (m). */
  update(viewScale: number, fromSun: number): void {
    if (!this.ctx || !this.graph) return;
    applyWeights(this.graph, layerWeights(viewScale, fromSun), this.ctx.currentTime);
  }

  /**
   * Render the soundscape along a recorded camera path without playing it.
   * The first sample's mix plays for `preroll` seconds before t = 0 (and is
   * trimmed off), so the drone is already sounding when the result starts.
   */
  async renderOffline(
    track: AmbientSample[],
    seconds: number,
    { sampleRate = 48000, seed = 1, preroll = 6 }: { sampleRate?: number; seed?: number; preroll?: number } = {},
  ): Promise<AudioBuffer> {
    const skip = Math.round(preroll * sampleRate);
    const length = Math.round(seconds * sampleRate);
    const ctx = new OfflineAudioContext(2, skip + length, sampleRate);
    const graph = buildGraph(ctx, mulberry32(seed));
    graph.master.gain.value = this.volume;
    if (track.length) {
      const w = layerWeights(track[0].viewScale, track[0].fromSun);
      for (const [name, g] of graph.layers) g.gain.value = graph.weights[name] = w[name];
    }
    for (const s of track) applyWeights(graph, layerWeights(s.viewScale, s.fromSun), preroll + s.t);
    const full = await ctx.startRendering();
    const out = new AudioBuffer({ numberOfChannels: 2, length, sampleRate });
    for (let c = 0; c < 2; c++) out.copyToChannel(full.getChannelData(c).subarray(skip, skip + length), c);
    return out;
  }
}

/** Glide each layer toward its weight, starting at time `t` (s on the context's clock). */
function applyWeights(graph: Graph, w: Weights, t: number): void {
  for (const [name, g] of graph.layers) {
    if (Math.abs(w[name] - graph.weights[name]) < 0.01) continue;
    graph.weights[name] = w[name];
    g.gain.setTargetAtTime(w[name], t, 1.2);
  }
}

/** Layers, reverb and a gentle compressor into the context's output. The master starts silent. */
function buildGraph(ctx: BaseAudioContext, rand: () => number): Graph {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.ratio.value = 3;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(comp);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 7, 2.2, rand);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(master);
  const dry = ctx.createGain();
  dry.gain.value = 0.6;
  dry.connect(master);
  const layers = new Map<LayerName, GainNode>();
  const bus = (name: LayerName): GainNode => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(dry);
    g.connect(reverb);
    layers.set(name, g);
    return g;
  };

  buildPlanet(ctx, bus('planet'), rand);
  buildSystem(ctx, bus('system'), rand);
  buildStars(ctx, bus('stars'));
  buildCosmos(ctx, bus('cosmos'), rand);
  return { master, layers, weights: { planet: 0, system: 0, stars: 0, cosmos: 0 } };
}

// ---- layers ------------------------------------------------------------------

function buildPlanet(ctx: BaseAudioContext, out: GainNode, rand: () => number): void {
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
  lfo(ctx, lp.frequency, 0.021, 140, rand);
  // Wind: brown noise through a wandering band-pass.
  const src = noise(ctx, 'brown', rand);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 500;
  bp.Q.value = 0.8;
  const ng = ctx.createGain();
  ng.gain.value = 0.18;
  src.connect(bp).connect(ng).connect(out);
  lfo(ctx, bp.frequency, 0.047, 260, rand);
  lfo(ctx, ng.gain, 0.031, 0.1, rand);
}

function buildSystem(ctx: BaseAudioContext, out: GainNode, rand: () => number): void {
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
    lfo(ctx, og.gain, 0.013 + i * 0.007, og.gain.value * 0.7, rand);
  });
}

function buildStars(ctx: BaseAudioContext, out: GainNode): void {
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

function buildCosmos(ctx: BaseAudioContext, out: GainNode, rand: () => number): void {
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
    lfo(ctx, og.gain, 0.008 + f * 0.0001, a * 0.8, rand);
  }
  // Soft hiss, like tuning between stations: a nod to the CMB's radio static.
  const src = noise(ctx, 'pink', rand);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 7000;
  const ng = ctx.createGain();
  ng.gain.value = 0.05;
  src.connect(hp).connect(lp).connect(ng).connect(g);
  lfo(ctx, ng.gain, 0.019, 0.03, rand);
}

// ---- helpers -----------------------------------------------------------------

function lfo(ctx: BaseAudioContext, param: AudioParam, hz: number, depth: number, rand: () => number): void {
  const o = ctx.createOscillator();
  o.frequency.value = hz;
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start(ctx.currentTime + rand() * 5);
}

function noise(ctx: BaseAudioContext, color: 'pink' | 'brown', rand: () => number): AudioBufferSourceNode {
  const len = ctx.sampleRate * 8;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = rand() * 2 - 1;
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
function impulse(ctx: BaseAudioContext, seconds: number, decay: number, rand: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp = lp * 0.7 + (rand() * 2 - 1) * 0.3;
      d[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/** A small seeded PRNG, so offline renders come out the same every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
