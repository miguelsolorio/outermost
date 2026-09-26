// Small-body positions (JPL SBDB elements propagated as two-body orbits) vs
// JPL Horizons, within about a year of the element epoch.
// Needs `npm run pipeline smallbodies` for the element file.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { elementsAt, keplerPosition, parseSmallBodies } from '../../src/astro/kepler.ts';
import fixture from '../fixtures/horizons/smallbodies.json';

const DIR = new URL('../../public/assets/smallbodies/', import.meta.url).pathname;
const have = existsSync(DIR + 'elements.bin');
const AU_KM = 149_597_870.7;
const TT_MINUS_UT_DAYS = 69.2 / 86400;

describe.skipIf(!have)('small bodies vs JPL Horizons', () => {
  const buf = have ? readFileSync(DIR + 'elements.bin') : Buffer.alloc(0);
  const sb = have ? parseSmallBodies(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) : null;
  const names = have ? (JSON.parse(readFileSync(DIR + 'names.json', 'utf8')).names as Array<{ i: number; name: string }>) : [];
  // Index by number through the names list, or by scanning H-sorted names.
  const index = (num: number) => names.find((n) => n.name.startsWith(`${num} `))?.i;

  for (const b of fixture.bodies) {
    it(`${b.name} (${b.number}) within 0.05° and 0.2% of Horizons`, () => {
      const i = index(b.number);
      expect(i, `${b.name} in names.json`).toBeDefined();
      const el = elementsAt(sb!.data, i!);
      for (const v of (fixture.vectors as Record<string, Array<{ jd_ut: number; pos_km: number[] }>>)[String(b.number)]) {
        const p = keplerPosition(el, v.jd_ut + TT_MINUS_UT_DAYS - sb!.epochJd).map((x) => x * AU_KM);
        const r = Math.hypot(...v.pos_km);
        const rp = Math.hypot(...p);
        const cos = (p[0] * v.pos_km[0] + p[1] * v.pos_km[1] + p[2] * v.pos_km[2]) / (r * rp);
        const sepDeg = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
        expect(sepDeg, `${b.name} @ JD ${v.jd_ut}`).toBeLessThan(0.05);
        expect(Math.abs(rp / r - 1), `${b.name} distance @ JD ${v.jd_ut}`).toBeLessThan(0.002);
      }
    });
  }
});
