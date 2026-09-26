// Moving the clock by hand. While a drag or an animated jump is under way the
// clock is held paused, then put back the way it was, so scrubbing never
// starts or stops playback on its own.

import { MAX_MS, MIN_MS } from '../../astro/time.ts';

export interface ClockState {
  ms: number;
  rate: number;
  paused: boolean;
}

export interface ClockIO {
  read(): ClockState;
  setTime(ms: number): void;
  setPaused(p: boolean): void;
}

const clampMs = (ms: number) => Math.min(MAX_MS, Math.max(MIN_MS, ms));

export class Scrubber {
  private holds = 0;
  private wasPaused = false;
  private tween: { from: number; to: number; t0: number; dur: number; done?: () => void } | null = null;

  constructor(private io: ClockIO) {}

  get active(): boolean {
    return this.holds > 0;
  }

  /** Paused as the user sees it: a scrub pauses the clock underneath, but Play shouldn't flip. */
  shownPaused(clockPaused: boolean): boolean {
    return this.holds ? this.wasPaused : clockPaused;
  }

  togglePlay(): void {
    if (this.holds) this.wasPaused = !this.wasPaused;
    else this.io.setPaused(!this.io.read().paused);
  }

  begin(): void {
    if (this.holds++ === 0) {
      this.wasPaused = this.io.read().paused;
      this.io.setPaused(true);
    }
  }

  end(): void {
    if (this.holds === 0) return;
    if (--this.holds === 0) this.io.setPaused(this.wasPaused);
  }

  to(ms: number): void {
    this.io.setTime(clampMs(ms));
  }

  /** Ease the clock to `ms`, then call `done`. */
  animateTo(ms: number, dur: number, done?: () => void): void {
    this.cancelTween();
    this.begin();
    this.tween = { from: this.io.read().ms, to: clampMs(ms), t0: performance.now(), dur, done };
  }

  cancelTween(): void {
    if (!this.tween) return;
    this.tween = null;
    this.end();
  }

  /** Advance an animated jump; call once per frame. */
  step(now: number): void {
    const tw = this.tween;
    if (!tw) return;
    const k = Math.min(1, (now - tw.t0) / tw.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.io.setTime(tw.from + (tw.to - tw.from) * e);
    if (k < 1) return;
    this.tween = null;
    this.end();
    tw.done?.();
  }

  /** Drop every hold, e.g. before jumping to now. */
  reset(): void {
    if (this.holds) this.io.setPaused(this.wasPaused);
    this.holds = 0;
    this.tween = null;
  }
}
