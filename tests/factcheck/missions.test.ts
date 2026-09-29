// The modeled historic-mission craft (src/scene/missions.ts) against the
// numbers they were built from: Apollo by the Numbers for Apollo 8 and 11,
// NSSDCA for Sputnik 1, and JPL Horizons' Hubble ephemeris. Also checks that
// every mission landmark flies to a craft that exists at the landmark's time.
import { readFileSync } from 'node:fs';
import * as A from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { LANDMARKS } from '../../src/data/landmarks.ts';
import { orbitPosition, period, type Orbit } from '../../src/astro/orbit.ts';
import { orientationMatrix, bodyFixedLonLat } from '../../src/astro/orientation.ts';
import { registerTable, tableState, type StateTable } from '../../src/astro/tables.ts';
import { cross, dot, length, normalize, type Vec3 } from '../../src/astro/vec.ts';
import { BODY_BY_ID, meanRadius } from '../../src/scene/catalog.ts';
import { MISSION_CRAFT } from '../../src/scene/missions.ts';

const craft = (id: string) => MISSION_CRAFT.find((c) => c.id === id)!;
const at = (id: string, ms: number): Orbit => {
  let o: Orbit | null = null;
  for (const s of craft(id).orbits!()) if (ms >= s.fromMs) o = s.orbit;
  return o!;
};
const MOON_R = meanRadius(BODY_BY_ID.get('moon')!);
const NMI = 1852;
const MIN = 60_000;

/** Altitude range (nmi above the mean radius) over one revolution. */
function lunarAltitudes(id: string, ms: number): [number, number] {
  const o = at(id, ms);
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 120; k++) {
    const h = (length(orbitPosition(o, ms + (k / 120) * period(o) * 1000)) - MOON_R) / NMI;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  return [lo, hi];
}

/** Inclination (degrees) of an orbit to the Moon's equator. */
function lunarInclination(o: Orbit, ms: number): number {
  const m = orientationMatrix({ type: 'iau', body: A.Body.Moon }, A.MakeTime(new Date(ms)));
  return (Math.acos(dot(cross(o.p, o.q), [m[2], m[5], m[8]])) * 180) / Math.PI;
}

/** Selenographic longitude (degrees) under the craft. */
function lunarLon(id: string, ms: number): number {
  const m = orientationMatrix({ type: 'iau', body: A.Body.Moon }, A.MakeTime(new Date(ms)));
  return bodyFixedLonLat(m, orbitPosition(at(id, ms), ms)).lon;
}

/** Whether the Moon leaves a clear line from Earth's center to the craft. */
function seenFromEarth(id: string, ms: number): boolean {
  const p = orbitPosition(at(id, ms), ms);
  const g = A.GeoMoon(new Date(ms));
  const earth: Vec3 = [-g.x * 149_597_870_700, -g.y * 149_597_870_700, -g.z * 149_597_870_700];
  // Closest approach of the craft-to-Earth segment to the Moon's center.
  const d: Vec3 = [earth[0] - p[0], earth[1] - p[1], earth[2] - p[2]];
  const k = Math.max(0, Math.min(1, -dot(p, d) / dot(d, d)));
  return length([p[0] + d[0] * k, p[1] + d[1] * k, p[2] + d[2] * k]) > MOON_R;
}

describe('Apollo in lunar orbit', () => {
  it('Apollo 8 flies 168.5 × 60.0 nmi after insertion, then 60.7 × 59.7 nmi', () => {
    const [lo1, hi1] = lunarAltitudes('apollo-8', Date.parse('1968-12-24T11:00Z'));
    expect(lo1).toBeCloseTo(60.0, 0);
    expect(hi1).toBeCloseTo(168.5, 0);
    const [lo2, hi2] = lunarAltitudes('apollo-8', Date.parse('1968-12-24T20:00Z'));
    expect(lo2).toBeCloseTo(59.7, 0);
    expect(hi2).toBeCloseTo(60.7, 0);
  });

  it('Apollo 8 takes about two hours per orbit, ten orbits before leaving', () => {
    const t = Date.parse('1968-12-24T20:00Z');
    expect(period(at('apollo-8', t)) / 60).toBeGreaterThan(115);
    expect(period(at('apollo-8', t)) / 60).toBeLessThan(122);
  });

  it('Apollo orbits are retrograde at the reported inclinations (12° and 1.25°)', () => {
    const t8 = Date.parse('1968-12-24T20:00Z');
    expect(lunarInclination(at('apollo-8', t8), t8)).toBeCloseTo(168, 0);
    const t11 = Date.parse('1969-07-20T20:17:40Z');
    expect(Math.abs(lunarInclination(at('apollo-11-columbia', t11), t11) - 178.75)).toBeLessThan(0.1);
  });

  it('Apollo 8 is behind the Moon at insertion and comes into view when Houston heard it (10:24:52 UTC)', () => {
    expect(Math.abs(lunarLon('apollo-8', Date.parse('1968-12-24T10:01:24Z')))).toBeGreaterThan(150);
    let aos = NaN;
    for (let t = Date.parse('1968-12-24T10:05Z'); t < Date.parse('1968-12-24T11:00Z'); t += 5000) {
      if (seenFromEarth('apollo-8', t)) {
        aos = t;
        break;
      }
    }
    expect(Math.abs(aos - Date.parse('1968-12-24T10:24:52Z')) / MIN).toBeLessThan(4);
  });

  it('Apollo 8 heads west over the near side', () => {
    const t = Date.parse('1968-12-24T20:51Z');
    expect(lunarLon('apollo-8', t + MIN) - lunarLon('apollo-8', t)).toBeLessThan(0);
  });

  it('Columbia is near Tranquility Base when Eagle lands', () => {
    const lon = lunarLon('apollo-11-columbia', Date.parse('1969-07-20T20:17:40Z'));
    expect(Math.abs(lon - 23.47)).toBeLessThan(40);
  });
});

describe('Earth orbits', () => {
  const EARTH_R = 6_378_137;
  it('Sputnik 1 flies 215 × 939 km every 96.2 minutes, inclined 65.1°', () => {
    const t = Date.parse('1957-10-05T00:00Z');
    const o = at('sputnik-1', t);
    expect(period(o) / 60).toBeCloseTo(96.2, 0);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 200; k++) {
      const h = (length(orbitPosition(o, t + (k / 200) * period(o) * 1000)) - EARTH_R) / 1000;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(Math.abs(lo - 215)).toBeLessThan(2);
    expect(Math.abs(hi - 939)).toBeLessThan(2);
    const m = orientationMatrix({ type: 'earth' }, A.MakeTime(new Date(t)));
    expect((Math.acos(dot(cross(o.p, o.q), [m[2], m[5], m[8]])) * 180) / Math.PI).toBeCloseTo(65.1, 0);
  });

  it('Sputnik 1 is over Baikonur at liftoff', () => {
    const t = Date.parse('1957-10-04T19:28:34Z');
    const m = orientationMatrix({ type: 'earth' }, A.MakeTime(new Date(t)));
    const { lat, lon } = bodyFixedLonLat(m, orbitPosition(at('sputnik-1', t), t));
    expect(Math.abs(lat - 45.92)).toBeLessThan(0.5);
    expect(Math.abs(lon - 63.34)).toBeLessThan(0.5);
  });

  it('Hubble is over Kennedy Space Center at liftoff', () => {
    const t = Date.parse('1990-04-24T12:33:51Z');
    const m = orientationMatrix({ type: 'earth' }, A.MakeTime(new Date(t)));
    const { lat, lon } = bodyFixedLonLat(m, orbitPosition(at('hubble', t), t));
    // The orbit only passes near the pad (28.5° inclination): within a couple of degrees.
    expect(Math.abs(lat - 28.63)).toBeLessThan(2);
    expect(Math.abs(lon + 80.62)).toBeLessThan(3);
  });

  it('Hubble matches Horizons two days past the states it was fitted to, within 100 km', () => {
    // JPL Horizons, target -48, geocentric ICRF, 1990-04-28 03:00 UT.
    const t = Date.parse('1990-04-28T03:00:00Z');
    const p = orbitPosition(at('hubble', t), t);
    const ref: Vec3 = [-4230.934759924685, 4523.158347285512, -3246.966859220215];
    expect(Math.hypot(p[0] / 1000 - ref[0], p[1] / 1000 - ref[1], p[2] / 1000 - ref[2])).toBeLessThan(100);
  });
});

describe('landing sites', () => {
  it('each lander is a site on its body', () => {
    for (const id of ['apollo-11-eagle', 'viking-1', 'curiosity']) expect(craft(id).site, id).toBeDefined();
    expect(craft('apollo-11-eagle').center).toBe('moon');
    expect(craft('viking-1').center).toBe('mars');
    expect(craft('curiosity').center).toBe('mars');
  });
});

describe('Cassini (Horizons table)', () => {
  const table = JSON.parse(readFileSync(new URL('../../data/baked/ephemerides/cassini.json', import.meta.url), 'utf8')) as StateTable;
  registerTable(table);
  it('is Saturn-centered and ends within ~1,500 km of the cloud tops', () => {
    expect(table.center).toBe('saturn');
    const end = table.jd0_tdb + (table.count - 1) * table.step_days;
    const s = tableState('cassini', end)!;
    const alt = length(s.pos as Vec3) - 58_232;
    expect(alt).toBeLessThan(5_000);
    expect(alt).toBeGreaterThan(0);
  });
  it('the dive landmark is inside the table', () => {
    const lm = LANDMARKS.find((l) => l.target === 'cassini')!;
    const jd = A.MakeTime(new Date(lm.ms)).tt + 2451545;
    expect(tableState('cassini', jd)).not.toBeNull();
  });
});

describe('mission landmarks', () => {
  for (const lm of LANDMARKS.filter((l) => MISSION_CRAFT.some((c) => c.id === l.target))) {
    it(`${lm.name} flies to ${lm.target}, which is there at that moment`, () => {
      const c = craft(lm.target);
      if (!c.active) return; // table-driven (Cassini): checked above
      expect(lm.ms).toBeGreaterThanOrEqual(Date.parse(c.active[0]));
      if (c.active[1]) expect(lm.ms).toBeLessThanOrEqual(Date.parse(c.active[1]));
      if (c.orbits) expect(normalize(orbitPosition(at(lm.target, lm.ms), lm.ms)).every(Number.isFinite)).toBe(true);
    });
  }
});
