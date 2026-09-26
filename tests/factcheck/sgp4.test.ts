// Sanity checks of the ISS propagation (SGP4 + TEME -> EQJ) against its
// published orbit: ~51.64° inclination and ~400-430 km altitude.
import { describe, expect, it } from 'vitest';
import { Sgp4Orbit } from '../../src/astro/sgp4.ts';
import tle from '../../data/baked/iss-tle.json';

describe('ISS from the bundled TLE', () => {
  const orbit = new Sgp4Orbit(tle.line1, tle.line2);
  it('orbits at the published altitude (370-460 km) through one revolution', () => {
    for (let k = 0; k < 12; k++) {
      const p = orbit.position(orbit.epochMs + k * 8 * 60_000)!;
      const alt = Math.hypot(...p) - 6371;
      expect(alt).toBeGreaterThan(370);
      expect(alt).toBeLessThan(460);
    }
  });
  it('orbital plane is inclined 51.64° ± 0.3° to the J2000 equator', () => {
    const a = orbit.position(orbit.epochMs)!;
    const b = orbit.position(orbit.epochMs + 60_000)!;
    const h = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const inc = (Math.acos(h[2] / Math.hypot(...h)) * 180) / Math.PI;
    expect(Math.abs(inc - 51.64)).toBeLessThan(0.3);
  });
  it('period is about 92-94 minutes', () => {
    expect(orbit.periodMin).toBeGreaterThan(92);
    expect(orbit.periodMin).toBeLessThan(94);
  });
});
