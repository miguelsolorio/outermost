// Fact-check: planet and Moon positions against JPL Horizons (baked fixtures).
import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import vectors from '../fixtures/horizons/vectors.json' with { type: 'json' };
import { stateRelativeToParent } from '../../src/astro/ephemeris.ts';
import { angleBetween, sub, type Vec3 } from '../../src/astro/vec.ts';
import { msFromJd } from '../../src/astro/time.ts';

const ARCSEC = Math.PI / (180 * 3600);
const BODIES: Record<string, A.Body> = {
  mercury: A.Body.Mercury,
  venus: A.Body.Venus,
  earth: A.Body.Earth,
  mars: A.Body.Mars,
  jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn,
  uranus: A.Body.Uranus,
  neptune: A.Body.Neptune,
  pluto: A.Body.Pluto,
};

const km = (v: number[]): Vec3 => [v[0] * 1e3, v[1] * 1e3, v[2] * 1e3];
type Row = { jd_ut: number; pos_km: number[] };
const helio = vectors.heliocentric as Record<string, Row[]>;

describe('heliocentric planet positions vs JPL Horizons', () => {
  for (const [name, body] of Object.entries(BODIES)) {
    it(`${name}: geocentric direction within 1 arcminute, distance within 0.1%`, () => {
      helio[name].forEach((row, i) => {
        const time = A.MakeTime(new Date(msFromJd(row.jd_ut)));
        const ours = stateRelativeToParent({ type: 'helio', body }, time).pos;
        const ref = km(row.pos_km);
        const earthRef = km(helio.earth[i].pos_km);
        const earthOurs = stateRelativeToParent({ type: 'helio', body: A.Body.Earth }, time).pos;
        const rel = Math.abs(Math.hypot(...ours) / Math.hypot(...ref) - 1);
        expect(rel, `${name} distance @ ${row.jd_ut}`).toBeLessThan(1e-3);
        if (name !== 'earth') {
          const err = angleBetween(sub(ours, earthOurs), sub(ref, earthRef)) / ARCSEC;
          expect(err, `${name} geocentric error (arcsec) @ ${row.jd_ut}`).toBeLessThan(60);
        } else {
          const err = angleBetween(ours, ref) / ARCSEC;
          expect(err, `earth heliocentric error (arcsec)`).toBeLessThan(10);
        }
      });
    });
  }
});

describe('geocentric Moon vs JPL Horizons', () => {
  it('direction within 1 arcminute and distance within 25 km', () => {
    for (const row of vectors.moon_geocentric as Row[]) {
      const time = A.MakeTime(new Date(msFromJd(row.jd_ut)));
      const ours = stateRelativeToParent({ type: 'geomoon' }, time).pos;
      const ref = km(row.pos_km);
      expect(angleBetween(ours, ref) / ARCSEC).toBeLessThan(60);
      expect(Math.abs(Math.hypot(...ours) - Math.hypot(...ref))).toBeLessThan(25_000); // ~11 km worst case observed at fixture epochs
    }
  });
});
