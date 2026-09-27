// The Landmarks timeline: a zoomable window onto 1600–2400 with landmark dots
// (and bars for those that last, like outbursts), the playhead and tick
// labels, drawn on a canvas. It owns the window (start
// and span), zoom, hover, dragging and keys; changes to time go through the
// Scrubber so they never start or stop playback.

import { DAY_MS as DAY, MAX_MS, MIN_MS } from '../../astro/time.ts';
import { KIND_COLOR, LANDMARKS, nearestLandmark, type Landmark } from '../../data/landmarks.ts';
import { gestures } from './gestures.ts';
import type { ClockState, Scrubber } from './scrub.ts';
import { addUnit, isStrong, MONTH, pickUnit, tickLabel, ticks, YEAR } from './ticks.ts';

const FULL = MAX_MS - MIN_MS;
/** The zoom buttons step through these spans. */
export const STEPS = [2 * DAY, 7 * DAY, MONTH, 6 * MONTH, 2 * YEAR, 10 * YEAR, 50 * YEAR, 200 * YEAR, FULL];
/** Inset so dots and labels at the ends aren't clipped. */
const PAD = 10;
const LANE_Y = 12;
const FONT = '500 10px Inter, system-ui, sans-serif';
const FONT_STRONG = '600 10px Inter, system-ui, sans-serif';

export function spanLabel(s: number): string {
  if (s >= FULL * 0.98) return 'All';
  if (s >= 2 * YEAR) return `${Math.round(s / YEAR)} yr`;
  if (s >= 2 * MONTH) return `${Math.round(s / MONTH)} mo`;
  return `${Math.round(s / DAY)} days`;
}

export interface TimelineHost {
  scrub: Scrubber;
  /** A landmark was clicked. */
  visit(lm: Landmark): void;
}

export class TimelineView {
  /** The landmark under the pointer, or the one a drag is snapped to. */
  hover: Landmark | null = null;
  /** Playhead position in px from the element's left edge, after the last frame. */
  playheadX = 0;
  width = 0;

  private start = Date.UTC(1900, 0, 1);
  private span = Date.UTC(2130, 0, 1) - this.start;
  /** Where `start` is easing to when the view pages after the playhead. */
  private startT = this.start;
  private zoomAnim: { from: number; to: number; t0: number; ms: number; frac: number } | null = null;
  /** Hand panning and zooming pause the follow-the-playhead paging for a moment. */
  private lastUser = -Infinity;
  private lastMs = NaN;
  private hoverX: number | null = null;
  private dragging = false;
  private dragX: number | null = null;
  private holding = false;
  private clock: ClockState = { ms: 0, rate: 1, paused: true };
  private drawn = '';
  private dispose: () => void;

  constructor(
    private el: HTMLElement,
    private canvas: HTMLCanvasElement,
    private host: TimelineHost,
  ) {
    const scrub = host.scrub;
    this.dispose = gestures(el, {
      down: () => {
        scrub.cancelTween();
        this.dragging = true;
      },
      move: (st) => {
        if (!st.moved) return;
        if (!this.holding) {
          scrub.begin();
          this.holding = true;
        }
        this.dragX = st.x;
        // Magnetic: within 9px of a landmark, the playhead snaps to it.
        this.hover = this.landmarkAt(st.x, 9);
        scrub.to(this.hover ? this.hover.ms : this.msAt(st.x));
      },
      up: (st) => {
        this.dragging = false;
        this.dragX = null;
        this.hoverX = st.x;
        if (this.holding) {
          this.holding = false;
          scrub.end();
          return;
        }
        const lm = this.landmarkAt(st.x);
        if (lm) host.visit(lm);
        else scrub.animateTo(this.msAt(st.x), 600);
      },
      cancel: () => {
        this.dragging = false;
        this.dragX = null;
        if (this.holding) {
          this.holding = false;
          scrub.end();
        }
      },
      hover: (x) => (this.hoverX = x),
      leave: () => (this.hoverX = null),
      zoom: (f, x) => this.zoomAt(f, x),
      pan: (dx) => this.panPx(-dx),
      wheelPan: (dx) => this.panPx(dx),
    });
  }

  destroy(): void {
    this.dispose();
    if (this.holding) this.host.scrub.end();
  }

  get zoomSpan(): number {
    return this.zoomAnim?.to ?? this.span;
  }
  get zoomLabel(): string {
    return spanLabel(this.zoomSpan);
  }
  get canZoomIn(): boolean {
    return this.zoomSpan > STEPS[0] * 1.02;
  }
  get canZoomOut(): boolean {
    return this.zoomSpan < FULL * 0.98;
  }

  /** Where the zoom sits between the closest (0) and the whole timeline (1), on a log scale. */
  get zoomFraction(): number {
    return Math.log(this.zoomSpan / STEPS[0]) / Math.log(FULL / STEPS[0]);
  }

  /** Zoom by a factor at once, as a pinch does, around the playhead if it's in view, else the middle. */
  zoomBy(f: number): void {
    const p = (this.clock.ms - this.start) / this.span;
    this.zoomAt(f, PAD + (p >= 0 && p <= 1 ? p : 0.5) * this.inner());
  }

  /** Step to the next zoom level in (1) or out (-1). */
  zoomStep(dir: 1 | -1): void {
    const s = this.zoomSpan;
    const next = dir > 0 ? STEPS.findLast((v) => v < s * 0.98) : STEPS.find((v) => v > s * 1.02);
    if (next) this.zoomTo(next);
  }

  /** x of a time, in px from the element's left edge. */
  xOf(ms: number): number {
    return PAD + ((ms - this.start) / this.span) * this.inner();
  }

  /** Arrow keys scrub, Shift+arrows visit landmarks, +/- zoom, 0 shows everything. Returns true if handled. */
  onKey(e: KeyboardEvent): boolean {
    const scrub = this.host.scrub;
    const ms = this.clock.ms;
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (step && e.shiftKey) {
      const lm = step < 0 ? LANDMARKS.findLast((l) => l.ms < ms - 60_000) : LANDMARKS.find((l) => l.ms > ms + 60_000);
      if (lm) this.host.visit(lm);
    } else if (step) {
      scrub.cancelTween();
      scrub.to(addUnit(ms, pickUnit(this.span / this.inner(), 7), step));
    } else if (e.key === '+' || e.key === '=') this.zoomStep(1);
    else if (e.key === '-' || e.key === '_') this.zoomStep(-1);
    else if (e.key === '0') this.zoomTo(FULL);
    else if (e.key === 'Home') scrub.to(MIN_MS);
    else if (e.key === 'End') scrub.to(MAX_MS);
    else return false;
    return true;
  }

  /** Update the window for this frame and redraw if anything visible changed. */
  frame(dt: number, clock: ClockState): void {
    this.clock = clock;
    const w = this.el.clientWidth;
    this.width = w;
    if (!w) return;
    const now = performance.now();

    // Follow the playhead: page ahead while playing, recenter after a jump.
    if (!this.dragging && clock.ms !== this.lastMs && this.span < FULL && now - this.lastUser > 2500) {
      const p = (clock.ms - this.startT) / this.span;
      const playing = !clock.paused;
      const back = clock.rate < 0;
      if (p < 0.02 || p > 0.98) this.startT = clock.ms - this.span * (playing ? (back ? 0.85 : 0.15) : 0.5);
      else if (playing && !back && p > 0.92) this.startT = clock.ms - this.span * 0.15;
      else if (playing && back && p < 0.08) this.startT = clock.ms - this.span * 0.85;
      this.clampStart();
    }
    this.lastMs = clock.ms;

    // Dragging near an end pans that way.
    if (this.dragging && this.dragX !== null) {
      const edge = this.dragX < 30 ? -1 : this.dragX > w - 30 ? 1 : 0;
      if (edge && this.span < FULL) {
        this.panPx(edge * this.inner() * 0.7 * dt);
        this.host.scrub.to(this.msAt(this.dragX));
      }
    }

    const za = this.zoomAnim;
    if (za) {
      const k = Math.min(1, (now - za.t0) / 320);
      const e = 1 - Math.pow(1 - k, 3);
      this.span = Math.exp(Math.log(za.from) + (Math.log(za.to) - Math.log(za.from)) * e);
      this.start = this.startT = za.ms - za.frac * this.span;
      this.clampStart();
      this.lastUser = now;
      if (k >= 1) this.zoomAnim = null;
    }
    this.start = Math.abs(this.startT - this.start) > 20 * this.span ? this.startT : this.start + (this.startT - this.start) * (1 - Math.exp(-dt * 9));

    if (!this.dragging) this.hover = this.hoverX !== null ? this.landmarkAt(this.hoverX) : null;
    this.el.style.cursor = this.hover ? 'pointer' : '';
    this.playheadX = this.xOf(clock.ms);
    this.draw(w);
  }

  // ---- window -------------------------------------------------------------

  private inner(): number {
    return Math.max(1, this.el.clientWidth - 2 * PAD);
  }

  private msAt(x: number): number {
    const xx = Math.min(this.el.clientWidth - PAD, Math.max(PAD, x));
    return this.start + ((xx - PAD) / this.inner()) * this.span;
  }

  private landmarkAt(x: number, px = 9): Landmark | null {
    const mpp = this.span / this.inner();
    return nearestLandmark(this.start + ((x - PAD) / this.inner()) * this.span, px * mpp);
  }

  private clampStart(): void {
    this.start = Math.min(MAX_MS - this.span, Math.max(MIN_MS, this.start));
    this.startT = Math.min(MAX_MS - this.span, Math.max(MIN_MS, this.startT));
  }

  private zoomAt(f: number, x: number): void {
    this.zoomAnim = null;
    const xx = Math.min(this.el.clientWidth - PAD, Math.max(PAD, x));
    const c = this.msAt(xx);
    this.span = Math.min(FULL, Math.max(STEPS[0], this.span * f));
    this.start = this.startT = c - ((xx - PAD) / this.inner()) * this.span;
    this.clampStart();
    this.lastUser = performance.now();
  }

  /** Ease to `to`, around the playhead if it's in view, otherwise the middle. */
  private zoomTo(to: number): void {
    const p = (this.clock.ms - this.start) / this.span;
    const onScreen = p >= 0 && p <= 1;
    this.zoomAnim = {
      from: this.span,
      to: Math.min(FULL, Math.max(STEPS[0], to)),
      t0: performance.now(),
      ms: onScreen ? this.clock.ms : this.start + this.span / 2,
      frac: onScreen ? p : 0.5,
    };
    this.lastUser = performance.now();
  }

  private panPx(dx: number): void {
    this.zoomAnim = null;
    this.start = this.startT = this.start + dx * (this.span / this.inner());
    this.clampStart();
    this.lastUser = performance.now();
  }

  // ---- drawing ------------------------------------------------------------

  private draw(w: number): void {
    const c = this.canvas;
    const h = c.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Skip identical frames (paused, nothing moving).
    const key = `${w}x${h}@${dpr}|${this.start}|${this.span}|${this.clock.ms}|${this.hover?.ms}|${Math.floor(Date.now() / 60_000)}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const a = this.start, b = this.start + this.span, x0 = PAD, x1 = w - PAD;
    const X = (t: number) => x0 + ((t - a) / (b - a)) * (x1 - x0);

    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.fillRect(x0, LANE_Y - 0.5, x1 - x0, 1);
    this.drawAxis(ctx, a, b, x0, x1);

    // Today, as a faint tick across the lane.
    const nx = X(Date.now());
    if (nx >= x0 && nx <= x1) {
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.fillRect(Math.round(nx) - 0.5, LANE_Y - 6, 1, 12);
    }

    // Outbursts: a faint bar under the dots, brighter while its dot is hovered.
    // Only the dot takes clicks, so landmarks inside the span stay reachable.
    for (const lm of LANDMARKS) {
      if (lm.until === undefined) continue;
      const xa = Math.max(x0, X(lm.ms)), xb = Math.min(x1, X(lm.until));
      if (xb - xa < 2) continue;
      ctx.globalAlpha = lm === this.hover ? 0.55 : 0.3;
      ctx.fillStyle = KIND_COLOR[lm.kind];
      ctx.fillRect(xa, LANE_Y - 1.5, xb - xa, 3);
    }
    ctx.globalAlpha = 1;

    // Landmarks: past ones filled, predicted ones as rings.
    const today = Date.now();
    for (const lm of LANDMARKS) {
      const x = X(lm.ms);
      if (x < x0 - 8 || x > x1 + 8) continue;
      const on = lm === this.hover;
      const r = on ? 5.3 : 3.5;
      const color = KIND_COLOR[lm.kind];
      ctx.beginPath();
      ctx.arc(x, LANE_Y, r, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(3,5,10,.85)';
      ctx.stroke();
      ctx.globalAlpha = on ? 1 : 0.92;
      if (lm.ms > today) {
        ctx.beginPath();
        ctx.arc(x, LANE_Y, r - 0.75, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // The playhead, or an arrow at the edge pointing to it.
    const px = X(this.clock.ms);
    ctx.fillStyle = '#8fb8ff';
    if (px >= x0 - 1 && px <= x1 + 1) {
      ctx.shadowColor = 'rgba(143,184,255,.75)';
      ctx.shadowBlur = 10;
      ctx.fillRect(Math.round(px) - 1, 0, 2, 32);
      ctx.shadowBlur = 0;
    } else {
      const left = px < x0, ex = left ? 2 : w - 2, dir = left ? 7 : -7;
      ctx.beginPath();
      ctx.moveTo(ex, LANE_Y);
      ctx.lineTo(ex + dir, LANE_Y - 5);
      ctx.lineTo(ex + dir, LANE_Y + 5);
      ctx.fill();
    }
  }

  /** Minor ticks every 7px or more, labelled major ticks every 56px or more. */
  private drawAxis(ctx: CanvasRenderingContext2D, a: number, b: number, x0: number, x1: number): void {
    const base = 23;
    const mpp = (b - a) / (x1 - x0);
    const minor = pickUnit(mpp, 7);
    const major = pickUnit(mpp, 56);
    const X = (t: number) => Math.round(x0 + (t - a) / mpp) + 0.5;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.2)';
    ctx.beginPath();
    for (const t of ticks(minor, a - 70 * mpp, b + 20 * mpp)) {
      ctx.moveTo(X(t), base);
      ctx.lineTo(X(t), base + 4);
    }
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const t of ticks(major, a - 70 * mpp, b + 20 * mpp)) {
      const x = X(t);
      const strong = isStrong(t, major);
      ctx.strokeStyle = strong ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.4)';
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, base + 8);
      ctx.stroke();
      // A label starting at the right edge would only show a sliver.
      if (x > x1 - 14) continue;
      ctx.font = strong ? FONT_STRONG : FONT;
      ctx.fillStyle = strong ? '#e8ecf4' : 'rgba(170,180,200,.95)';
      ctx.fillText(tickLabel(t, major), x + 4, 45);
    }
  }
}
