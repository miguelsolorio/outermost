// Simulation clock. Time is kept as UTC milliseconds (JS epoch) in float64,
// which resolves ~0.1 µs today and stays sub-millisecond for ±100,000 years.
// astronomy-engine converts UT to TT internally using its ΔT model.

export const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
export const DAY_MS = 86_400_000;

export const jdFromMs = (ms: number): number => ms / DAY_MS + 2_440_587.5;
export const msFromJd = (jd: number): number => (jd - 2_440_587.5) * DAY_MS;
/** Days since J2000.0 (UT). */
export const daysSinceJ2000 = (ms: number): number => (ms - J2000_MS) / DAY_MS;

/** Supported simulation range. astronomy-engine is validated roughly 1700–2200. */
export const MIN_MS = Date.UTC(1600, 0, 1);
export const MAX_MS = Date.UTC(2400, 0, 1);

export class SimClock {
  /** Simulated UTC in ms. */
  ms: number;
  /** Simulated seconds per real second. 1 = real time. */
  rate = 1;
  paused = false;
  private listeners = new Set<() => void>();

  constructor(startMs = Date.now()) {
    this.ms = startMs;
  }

  /** Advance by a real-time delta (seconds). Returns simulated ms advanced. */
  tick(realDtSec: number): number {
    if (this.paused) return 0;
    const before = this.ms;
    this.ms = Math.min(MAX_MS, Math.max(MIN_MS, this.ms + realDtSec * 1000 * this.rate));
    if (this.ms === MIN_MS || this.ms === MAX_MS) this.paused = true;
    return this.ms - before;
  }

  set(ms: number): void {
    this.ms = Math.min(MAX_MS, Math.max(MIN_MS, ms));
    this.emit();
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.emit();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.emit();
  }

  get date(): Date {
    return new Date(this.ms);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
