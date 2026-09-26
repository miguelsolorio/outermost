// Timeline landmarks that astronomy-engine can predict, checked against it:
// greatest solar eclipse, greatest transit, and the 2020 great conjunction.
import * as A from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { LANDMARKS } from '../../src/data/landmarks.ts';

const MIN = 60_000;
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const named = (re: RegExp) => LANDMARKS.filter((l) => re.test(l.name));

describe('timeline landmarks vs astronomy-engine', () => {
  for (const lm of named(/solar eclipse/i)) {
    it(`${iso(lm.ms)} is greatest eclipse of a total solar eclipse (within 5 min)`, () => {
      const e = A.SearchGlobalSolarEclipse(new Date(lm.ms - 20 * DAY));
      expect(e.kind).toBe(A.EclipseKind.Total);
      expect(Math.abs(e.peak.date.getTime() - lm.ms) / MIN, `peak ${e.peak.date.toISOString()}`).toBeLessThan(5);
    });

    it(`${iso(lm.ms)} arrives at Earth from the Moon's side, looking down the shadow`, () => {
      expect(lm.target).toBe('earth');
      expect(lm.from).toBe('moon');
      // From Earth the Moon sits in front of the Sun, so the view from the Moon's side is the Sun's.
      const date = new Date(lm.ms);
      expect(A.AngleBetween(A.GeoMoon(date), A.GeoVector(A.Body.Sun, date, true))).toBeLessThan(1);
    });
  }

  for (const lm of named(/transit of (venus|mercury)/i)) {
    const body = /venus/i.test(lm.name) ? A.Body.Venus : A.Body.Mercury;
    it(`${iso(lm.ms)} is greatest ${body} transit (within 10 min)`, () => {
      const t = A.SearchTransit(body, new Date(lm.ms - 30 * DAY));
      expect(Math.abs(t.peak.date.getTime() - lm.ms) / MIN, `peak ${t.peak.date.toISOString()}`).toBeLessThan(10);
    });
  }

  it('the great conjunction landmark is the closest approach of Jupiter and Saturn', () => {
    const [lm] = named(/great conjunction/i);
    const sep = (ms: number) => A.AngleBetween(A.GeoVector(A.Body.Jupiter, new Date(ms), true), A.GeoVector(A.Body.Saturn, new Date(ms), true));
    // About a tenth of a degree, and farther apart a day either side.
    expect(sep(lm.ms)).toBeLessThan(0.11);
    expect(sep(lm.ms - DAY)).toBeGreaterThan(sep(lm.ms));
    expect(sep(lm.ms + DAY)).toBeGreaterThan(sep(lm.ms));
  });

  it('is in date order, inside the simulation range', () => {
    const ms = LANDMARKS.map((l) => l.ms);
    expect(ms.every(Number.isFinite)).toBe(true);
    expect([...ms].sort((a, b) => a - b)).toEqual(ms);
    expect(Math.min(...ms)).toBeGreaterThan(Date.UTC(1600, 0, 1));
    expect(Math.max(...ms)).toBeLessThan(Date.UTC(2400, 0, 1));
  });
});
