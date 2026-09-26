// Fact-check: body orientation (and therefore texture alignment) against the
// apparent sub-observer points JPL Horizons reports from Earth's center, and
// Earth's subsolar point as seen from the Sun.
import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import subpoints from '../fixtures/horizons/subpoints.json' with { type: 'json' };
import earthSubsolar from '../fixtures/horizons/earth-subsolar.json' with { type: 'json' };
import nssdca from '../../data/baked/nssdca.json' with { type: 'json' };
import { stateRelativeToParent } from '../../src/astro/ephemeris.ts';
import { bodyFixedLonLat, orientationMatrix, type OrientationModel } from '../../src/astro/orientation.ts';
import { add, sub, normalize, length, wrapDeg180, type Vec3 } from '../../src/astro/vec.ts';
import { C, DEG } from '../../src/astro/units.ts';
import { msFromJd } from '../../src/astro/time.ts';

type SubRow = { calendar: string; obsLon: number; obsLat: number };
type SubBody = { lonPositive: 'east' | 'west'; rows: SubRow[] };

const HELIO: Record<string, A.Body> = {
  mercury: A.Body.Mercury,
  venus: A.Body.Venus,
  mars: A.Body.Mars,
  jupiter: A.Body.Jupiter,
  saturn: A.Body.Saturn,
  uranus: A.Body.Uranus,
  neptune: A.Body.Neptune,
  pluto: A.Body.Pluto,
};

const MODELS: Record<string, OrientationModel> = {
  sun: { type: 'iau', body: A.Body.Sun },
  moon: { type: 'iau', body: A.Body.Moon },
  ...Object.fromEntries(Object.entries(HELIO).map(([k, b]) => [k, { type: 'iau', body: b } as OrientationModel])),
};

// IAU 2009 (Horizons) vs WGCCRE 2015 (ours) prime meridians differ slightly for some bodies.
const LON_TOL_DEG: Record<string, number> = { mars: 1.0, default: 0.5 };

/** Horizons reports planetodetic latitude on an oblate spheroid; ours is planetocentric. */
function detic2centric(latDeg: number, body: string): number {
  const si = (nssdca.bodies as unknown as Record<string, { si: Record<string, number> }>)[body]?.si ?? {};
  const f = si.radius_equatorial_m && si.radius_polar_m ? 1 - si.radius_polar_m / si.radius_equatorial_m : 0;
  return Math.atan((1 - f) ** 2 * Math.tan(latDeg * DEG)) / DEG;
}

function helioPos(name: string, time: A.AstroTime): Vec3 {
  if (name === 'sun') return [0, 0, 0];
  if (name === 'moon') {
    const e = stateRelativeToParent({ type: 'helio', body: A.Body.Earth }, time).pos;
    return add(e, stateRelativeToParent({ type: 'geomoon' }, time).pos);
  }
  return stateRelativeToParent({ type: 'helio', body: HELIO[name] }, time).pos;
}

function jdFromCalendar(cal: string): number {
  const d = new Date(cal.replace(/^(\d{4})-(\w{3})-(\d{2}) /, '$2 $3 $1 ') + ' UTC');
  return d.getTime() / 86_400_000 + 2_440_587.5;
}

describe('sub-observer point from Earth vs JPL Horizons', () => {
  for (const [name, model] of Object.entries(MODELS)) {
    it(`${name}`, () => {
      const ref = (subpoints.bodies as Record<string, SubBody>)[name];
      for (const row of ref.rows) {
        const tMs = msFromJd(jdFromCalendar(row.calendar));
        const tObs = A.MakeTime(new Date(tMs));
        const earth = stateRelativeToParent({ type: 'helio', body: A.Body.Earth }, tObs).pos;
        // Iterate light time: body is seen where it was at t - tau.
        let tau = 0;
        let target = helioPos(name, tObs);
        for (let i = 0; i < 3; i++) {
          tau = length(sub(target, earth)) / C;
          target = helioPos(name, A.MakeTime(new Date(tMs - tau * 1000)));
        }
        const tEmit = A.MakeTime(new Date(tMs - tau * 1000));
        const m = orientationMatrix(model, tEmit);
        const { lon, lat } = bodyFixedLonLat(m, normalize(sub(earth, target)));
        const refLonEast = ref.lonPositive === 'west' ? -row.obsLon : row.obsLon;
        const refLat = detic2centric(row.obsLat, name);
        const tol = LON_TOL_DEG[name] ?? LON_TOL_DEG.default;
        expect(Math.abs(wrapDeg180(lon - refLonEast)), `${name} lon @ ${row.calendar}`).toBeLessThan(tol);
        expect(Math.abs(lat - refLat), `${name} lat @ ${row.calendar}`).toBeLessThan(0.2);
      }
    });
  }
});

describe('Earth subsolar point vs JPL Horizons', () => {
  it('matches within 0.05 degrees (GAST + precession-nutation)', () => {
    const f = 1 / 298.257223563; // WGS84
    for (const row of earthSubsolar.earth.rows as SubRow[]) {
      const tMs = msFromJd(jdFromCalendar(row.calendar));
      const tObs = A.MakeTime(new Date(tMs));
      // Observer is the Sun's center at t; Earth is seen as it was at t - tau.
      let earth = stateRelativeToParent({ type: 'helio', body: A.Body.Earth }, tObs).pos;
      const tau = length(earth) / C;
      const tEmit = A.MakeTime(new Date(tMs - tau * 1000));
      earth = stateRelativeToParent({ type: 'helio', body: A.Body.Earth }, tEmit).pos;
      const m = orientationMatrix({ type: 'earth' }, tEmit);
      const { lon, lat } = bodyFixedLonLat(m, normalize([-earth[0], -earth[1], -earth[2]]));
      const refLat = Math.atan((1 - f) ** 2 * Math.tan(row.obsLat * DEG)) / DEG;
      expect(Math.abs(wrapDeg180(lon - row.obsLon)), `lon @ ${row.calendar}`).toBeLessThan(0.05);
      expect(Math.abs(lat - refLat), `lat @ ${row.calendar}`).toBeLessThan(0.05);
    }
  });
});
