// Fact-check moon positions (planet-centered) against JPL Horizons.
import { describe, expect, it } from 'vitest';
import * as A from 'astronomy-engine';
import moons from '../fixtures/horizons/moons.json' with { type: 'json' };
import sats from '../../data/baked/satellites.json' with { type: 'json' };
import { fittedPosition, type FittedElements, type MeanElements } from '../../src/astro/satellites.ts';
import { stateRelativeToParent } from '../../src/astro/ephemeris.ts';
import { angleBetween, length, type Vec3 } from '../../src/astro/vec.ts';
import { msFromJd } from '../../src/astro/time.ts';

type Row = { jd_ut: number; pos_km: number[] };
const REFS = moons.moons as Record<string, Row[]>;
const ELEMS = sats.elements as unknown as Record<string, MeanElements & { planet: string }>;
const FITS = sats.fits as unknown as Record<string, FittedElements>;


/** Orbital-phase error (degrees) and radius error (fraction) vs Horizons. */
function errors(ours: Vec3, ref: Vec3) {
  return { deg: (angleBetween(ours, ref) * 180) / Math.PI, dr: Math.abs(length(ours) / length(ref) - 1) };
}

// Tolerance in orbital position angle over 2000–2035.
const TOL_DEG: Record<string, number> = { default: 2 };

describe('moons from mean elements refit to JPL Horizons (1995–2045)', () => {
  for (const id of Object.keys(ELEMS)) {
    it(id, () => {
      let worst = 0;
      for (const row of REFS[id]) {
        const t = A.MakeTime(new Date(msFromJd(row.jd_ut)));
        const { pos } = fittedPosition(FITS[id], t.tt + 2451545.0);
        worst = Math.max(worst, errors(pos, row.pos_km as Vec3).deg);
      }
      expect(worst, `${id} worst angular error (deg) over 2000–2035`).toBeLessThan(TOL_DEG[id] ?? TOL_DEG.default);
    });
  }
});

describe('Galilean moons (astronomy-engine) vs JPL Horizons', () => {
  for (const id of ['io', 'europa', 'ganymede', 'callisto'] as const) {
    it(id, () => {
      for (const row of REFS[id]) {
        const t = A.MakeTime(new Date(msFromJd(row.jd_ut)));
        const pos = stateRelativeToParent({ type: 'jupiterMoon', moon: id }, t).pos.map((c) => c / 1000) as Vec3;
        expect(errors(pos, row.pos_km as Vec3).deg).toBeLessThan(0.5);
      }
    });
  }
});
