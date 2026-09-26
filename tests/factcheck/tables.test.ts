// The Hermite-interpolated Horizons tables must reproduce Horizons itself at
// epochs between table samples. Pluto is the barycenter table plus its wobble
// around the Pluto–Charon barycenter.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vectors from '../fixtures/horizons/vectors.json' with { type: 'json' };
import sats from '../../data/baked/satellites.json' with { type: 'json' };
import * as A from 'astronomy-engine';
import { registerTable, type StateTable } from '../../src/astro/tables.ts';
import { stateRelativeToParent } from '../../src/astro/ephemeris.ts';
import type { FittedElements } from '../../src/astro/satellites.ts';
import { msFromJd } from '../../src/astro/time.ts';

const bary = JSON.parse(readFileSync(new URL('../../data/baked/ephemerides/pluto-barycenter.json', import.meta.url), 'utf8')) as StateTable;
registerTable(bary);
const phys = sats.physical as unknown as Record<string, { gm_km3_s2: number }>;
const ratio = phys.charon.gm_km3_s2 / (phys.charon.gm_km3_s2 + 869.6);

describe('Horizons state tables (Hermite interpolation)', () => {
  it('Pluto (barycenter table + Charon wobble) matches Horizons within 100 km', () => {
    for (const row of vectors.heliocentric.pluto as Array<{ jd_ut: number; pos_km: number[] }>) {
      const t = A.MakeTime(new Date(msFromJd(row.jd_ut)));
      const s = stateRelativeToParent(
        { type: 'table', id: 'pluto-barycenter', companion: { elements: sats.fits.charon as unknown as FittedElements, ratio } },
        t,
      );
      const d = Math.hypot(s.pos[0] / 1e3 - row.pos_km[0], s.pos[1] / 1e3 - row.pos_km[1], s.pos[2] / 1e3 - row.pos_km[2]);
      expect(d, `Pluto error (km) at JD ${row.jd_ut}`).toBeLessThan(100);
    }
  });
});
