import { describe, expect, it } from 'vitest';
import { DAY_MS, MAX_MS } from '../../src/astro/time.ts';
import { addUnit, HOUR, MONTH, pickUnit, tickLabel, ticks, UNITS, YEAR } from '../../src/ui/timeline/ticks.ts';
import { Scrubber, type ClockState } from '../../src/ui/timeline/scrub.ts';

const unit = (t: string, n: number) => UNITS.find((u) => u.t === t && u.n === n)!;

describe('timeline ticks', () => {
  it('picks units by on-screen spacing', () => {
    // A day across 80px: 3-hour minor ticks, a labelled tick per day.
    expect(pickUnit(DAY_MS / 80, 7)).toMatchObject({ t: 'ms', n: 3 * HOUR });
    expect(pickUnit(DAY_MS / 80, 56)).toMatchObject({ t: 'ms', n: DAY_MS });
    expect(pickUnit(YEAR / 80, 56)).toMatchObject({ t: 'y', n: 1 });
    // Wider than any unit: the largest one.
    expect(pickUnit(1000 * YEAR, 56)).toMatchObject({ t: 'y', n: 200 });
  });

  it('lands month and year ticks on calendar boundaries in UTC', () => {
    const mo = [...ticks(unit('mo', 3), Date.UTC(2025, 10, 5), Date.UTC(2026, 7, 1))];
    expect(mo.map((t) => new Date(t).toISOString().slice(0, 10))).toEqual(['2026-01-01', '2026-04-01', '2026-07-01']);
    const decades = [...ticks(unit('y', 10), Date.UTC(1983, 0, 1), Date.UTC(2011, 0, 1))];
    expect(decades.map((t) => new Date(t).getUTCFullYear())).toEqual([1990, 2000, 2010]);
  });

  it('puts weekly ticks on the same days of every month', () => {
    const days = [...ticks(unit('dm', 7), Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 31))].map((t) => new Date(t).getUTCDate());
    expect(days).toEqual([1, 8, 15, 22, 1, 8, 15, 22]);
  });

  it('stops at the end of the simulation range', () => {
    const t = [...ticks(unit('y', 100), MAX_MS - 300 * YEAR, MAX_MS + 300 * YEAR)];
    expect(Math.max(...t)).toBe(MAX_MS);
  });

  it('labels ticks for their scale', () => {
    expect(tickLabel(Date.UTC(2026, 8, 25, 14), unit('ms', HOUR))).toBe('14:00');
    expect(tickLabel(Date.UTC(2026, 8, 25), unit('ms', HOUR))).toBe('Sep 25');
    expect(tickLabel(Date.UTC(2026, 2, 1), unit('mo', 1))).toBe('Mar');
    expect(tickLabel(Date.UTC(2026, 0, 1), unit('mo', 1))).toBe('2026');
    expect(tickLabel(Date.UTC(1980, 0, 1), unit('y', 10))).toBe('1980s');
  });

  it('steps by calendar months, keeping the day', () => {
    const d = new Date(addUnit(Date.UTC(2026, 0, 15, 6), unit('mo', 1), 1));
    expect(d.toISOString()).toBe('2026-02-15T06:00:00.000Z');
    expect(unit('mo', 1).approx).toBeCloseTo(MONTH);
  });
});

describe('scrubbing never starts or stops playback', () => {
  const clock = (paused: boolean) => {
    const c: ClockState = { ms: 0, rate: 1, paused };
    const s = new Scrubber({
      read: () => ({ ...c }),
      setTime: (ms) => (c.ms = ms),
      setPaused: (p) => (c.paused = p),
    });
    return { c, s };
  };

  it('holds the clock while dragging, then puts it back', () => {
    for (const startPaused of [true, false]) {
      const { c, s } = clock(startPaused);
      s.begin();
      expect(c.paused).toBe(true);
      expect(s.shownPaused(c.paused)).toBe(startPaused);
      s.to(123);
      s.end();
      expect(c.ms).toBe(123);
      expect(c.paused).toBe(startPaused);
    }
  });

  it('animates to a time, then calls back', () => {
    const { c, s } = clock(true);
    let arrived = false;
    s.animateTo(1000, 100, () => (arrived = true));
    s.step(performance.now() + 200);
    expect(c.ms).toBe(1000);
    expect(arrived).toBe(true);
    expect(s.active).toBe(false);
    expect(c.paused).toBe(true);
  });

  it('lets Play change what the clock goes back to mid-scrub', () => {
    const { c, s } = clock(true);
    s.begin();
    s.togglePlay();
    expect(s.shownPaused(c.paused)).toBe(false);
    s.end();
    expect(c.paused).toBe(false);
  });
});
