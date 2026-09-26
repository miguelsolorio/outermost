// Calendar-aware tick marks for the timeline, in UTC. A unit is either a fixed
// span of milliseconds, fixed days of the month, whole months, or whole years.

import { DAY_MS as DAY, MAX_MS, MIN_MS } from '../../astro/time.ts';

export const HOUR = 3_600_000;
export const YEAR = 365.25 * DAY;
export const MONTH = YEAR / 12;

export interface Unit {
  t: 'ms' | 'dm' | 'mo' | 'y';
  n: number;
  /** Rough length in ms, for choosing a unit by on-screen spacing. */
  approx: number;
  /** For 'dm': the days of the month that get a tick. */
  days?: number[];
}

const BASE: Array<Omit<Unit, 'approx'> & { approx?: number }> = [
  { t: 'ms', n: 60e3 },
  { t: 'ms', n: 5 * 60e3 },
  { t: 'ms', n: 15 * 60e3 },
  { t: 'ms', n: HOUR },
  { t: 'ms', n: 3 * HOUR },
  { t: 'ms', n: 6 * HOUR },
  { t: 'ms', n: 12 * HOUR },
  { t: 'ms', n: DAY },
  { t: 'dm', n: 7, days: [1, 8, 15, 22], approx: 7.6 * DAY },
  { t: 'dm', n: 14, days: [1, 15], approx: 15.2 * DAY },
  { t: 'mo', n: 1 },
  { t: 'mo', n: 3 },
  { t: 'mo', n: 6 },
  { t: 'y', n: 1 },
  { t: 'y', n: 5 },
  { t: 'y', n: 10 },
  { t: 'y', n: 25 },
  { t: 'y', n: 50 },
  { t: 'y', n: 100 },
  { t: 'y', n: 200 },
];

export const UNITS: Unit[] = BASE.map((u) => ({ ...u, approx: u.approx ?? (u.t === 'ms' ? u.n : u.t === 'mo' ? u.n * MONTH : u.n * YEAR) }));

/** The finest unit whose ticks land at least `px` apart at `msPerPx`. */
export const pickUnit = (msPerPx: number, px: number): Unit => UNITS.find((u) => u.approx / msPerPx >= px) ?? UNITS[UNITS.length - 1];

/** Tick times of `u` in [a, b], clipped to the simulation range. */
export function* ticks(u: Unit, a: number, b: number): Generator<number> {
  a = Math.max(a, MIN_MS);
  b = Math.min(b, MAX_MS);
  if (!(b >= a)) return;
  let guard = 0;
  if (u.t === 'ms') {
    for (let t = Math.ceil(a / u.n) * u.n; t <= b && guard++ < 3000; t += u.n) yield t;
  } else if (u.t === 'dm') {
    for (let t = Math.floor(a / DAY) * DAY; t <= b && guard++ < 6000; t += DAY) {
      if (t >= a && u.days!.includes(new Date(t).getUTCDate())) yield t;
    }
  } else if (u.t === 'mo') {
    const d = new Date(a);
    let y = d.getUTCFullYear();
    let m = Math.floor(d.getUTCMonth() / u.n) * u.n;
    for (;;) {
      const t = Date.UTC(y, m, 1);
      if (t > b || guard++ > 3000) break;
      if (t >= a) yield t;
      m += u.n;
      if (m >= 12) {
        m -= 12;
        y++;
      }
    }
  } else {
    let y = Math.floor(new Date(a).getUTCFullYear() / u.n) * u.n;
    for (;;) {
      const t = Date.UTC(y, 0, 1);
      if (t > b || guard++ > 3000) break;
      if (t >= a) yield t;
      y += u.n;
    }
  }
}

/** `ms` moved by `k` units, keeping the calendar day where months and years are involved. */
export function addUnit(ms: number, u: Unit, k: number): number {
  if (u.t === 'ms') return ms + u.n * k;
  if (u.t === 'dm') return ms + DAY * u.n * k;
  const d = new Date(ms);
  if (u.t === 'mo') d.setUTCMonth(d.getUTCMonth() + u.n * k);
  else d.setUTCFullYear(d.getUTCFullYear() + u.n * k);
  return d.getTime();
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Label for a tick of `u`: "14:00", "Sep 25", "Mar", "2026" or "1980s". */
export function tickLabel(t: number, u: Unit): string {
  const d = new Date(t);
  const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate();
  if (u.t === 'ms' && u.n < DAY) {
    const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
    return midnight ? `${MON[M]} ${D}` : `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  if (u.t === 'ms' || u.t === 'dm') return M === 0 && D === 1 ? String(Y) : `${MON[M]} ${D}`;
  if (u.t === 'mo') return M === 0 ? String(Y) : MON[M];
  if (u.n === 10) return `${Y}s`;
  return String(Y);
}

/** Ticks on the next unit up (midnight, the 1st, January, a round decade) are drawn brighter. */
export function isStrong(t: number, u: Unit): boolean {
  const d = new Date(t);
  if (u.t === 'ms' && u.n < DAY) return d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  if (u.t === 'ms' || u.t === 'dm') return d.getUTCDate() === 1;
  if (u.t === 'mo') return d.getUTCMonth() === 0;
  if (u.n < 10) return d.getUTCFullYear() % 10 === 0;
  return d.getUTCFullYear() % 100 === 0;
}
