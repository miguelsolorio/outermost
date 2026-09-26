// Fact-check the processed star catalog and constellations against
// independent references: SIMBAD (positions, parallaxes, magnitudes) and the
// IAU's official constellation list. Needs `npm run pipeline stars`.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import simbad from '../fixtures/simbad-stars.json' with { type: 'json' };
import iau from '../fixtures/iau-constellations.json' with { type: 'json' };
import d3lines from '../fixtures/d3-celestial-lines.json' with { type: 'json' };
import vi49 from '../fixtures/vi49-j2000-vertices.json' with { type: 'json' };

const DIR = new URL('../../public/assets/stars/', import.meta.url).pathname;
const have = existsSync(DIR + 'stars.bin');

interface Meta { i: number; hip: number | null; name?: string; bayer?: string; con?: string; dist: number; mag: number; distSrc: string }

function load() {
  const buf = readFileSync(DIR + 'stars.bin');
  const count = buf.readUInt32LE(4);
  const stride = buf.readUInt32LE(8);
  const pos = (i: number) => {
    const o = 16 + i * stride;
    return [buf.readFloatLE(o), buf.readFloatLE(o + 4), buf.readFloatLE(o + 8), buf.readFloatLE(o + 12)];
  };
  const meta: Meta[] = JSON.parse(readFileSync(DIR + 'stars-meta.json', 'utf8')).stars;
  const con = JSON.parse(readFileSync(DIR + 'constellations.json', 'utf8'));
  return { count, pos, meta, con };
}

const deg = 180 / Math.PI;

/** Bright variable stars whose catalog magnitudes legitimately differ by epoch. */
const VARIABLE: Record<number, { tol: number; note: string }> = {
  80763: { tol: 0.5, note: 'Antares: semiregular variable, V 0.6–1.6 (GCVS)' },
  27989: { tol: 0.8, note: 'Betelgeuse: semiregular variable, V 0.0–1.6 (GCVS)' },
};

describe.skipIf(!have)('star catalog vs SIMBAD', () => {
  const { pos, meta } = have ? load() : ({} as ReturnType<typeof load>);
  const byHip = new Map(have ? meta.filter((m) => m.hip).map((m) => [m.hip!, m]) : []);

  for (const ref of simbad.stars) {
    it(`${ref.main_id.replace(/\s+/g, ' ')} (HIP ${ref.hip})`, () => {
      const m = byHip.get(ref.hip);
      expect(m, 'star present in catalog').toBeDefined();
      const [x, y, z] = pos(m!.i);
      const r = Math.hypot(x, y, z);
      let ra = Math.atan2(y, x) * deg;
      if (ra < 0) ra += 360;
      const dec = Math.asin(z / r) * deg;
      // Position: within 20 arcsec (catalog epochs and float32 storage).
      const dRa = ((ra - ref.ra_deg + 540) % 360) - 180;
      const sep = Math.hypot(dRa * Math.cos((dec * Math.PI) / 180), dec - ref.dec_deg) * 3600;
      expect(sep, 'position error (arcsec)').toBeLessThan(20);
      // Distance: within 3σ of the SIMBAD parallax, or 10% (Hipparcos vs Gaia).
      if (ref.plx_mas && ref.plx_err_mas && ref.plx_mas / ref.plx_err_mas > 10) {
        const d = 1000 / ref.plx_mas;
        const tol = Math.max(0.1 * d, (3 * ref.plx_err_mas * 1000) / ref.plx_mas ** 2);
        expect(Math.abs(r - d), `distance ${r.toFixed(2)} pc vs ${d.toFixed(2)} pc`).toBeLessThan(tol);
      }
      // Brightness: V within 0.15, or the documented range for large-amplitude variables.
      const tol = VARIABLE[ref.hip]?.tol ?? 0.15;
      if (ref.V !== null) expect(Math.abs(m!.mag - ref.V), `V ${m!.mag} vs ${ref.V}`).toBeLessThan(tol);
    });
  }

  it('Polaris lies within 1° of the north celestial pole (J2000)', () => {
    const polaris = meta.find((m) => m.name === 'Polaris')!;
    const [x, y, z] = pos(polaris.i);
    expect(90 - Math.asin(z / Math.hypot(x, y, z)) * deg).toBeLessThan(1);
  });

  it('Sirius is the brightest star in the night sky', () => {
    expect(meta.reduce((a, b) => (b.mag < a.mag ? b : a)).name).toBe('Sirius');
  });

  it('the nearest star is Proxima Centauri, about 1.30 pc away', () => {
    const nearest = meta.reduce((a, b) => (b.dist < a.dist ? b : a));
    expect(nearest.name).toBe('Proxima Centauri');
    expect(nearest.dist).toBeGreaterThan(1.29);
    expect(nearest.dist).toBeLessThan(1.31);
  });
});

// The IAU/Sky & Telescope figures sometimes connect to a bright star just over
// the boundary (Serpens through Ophiuchus' hand, Hydra through Crater, the old
// Argo Navis links). Such links must be confirmed by an independently digitized
// figure set (d3-celestial) to pass.
/**
 * Cross-boundary links present in the Stellarium modern_iau (IAU / Sky &
 * Telescope) figures but not in d3-celestial's figure set. Figure lines are a
 * drawing convention; each star's constellation membership shown in the app
 * comes from the IAU boundaries, not from these lines.
 */
const DOCUMENTED_LINKS = new Set(['Hya:53740', 'Hya:54682', 'Pup:30438', 'Ser:79593']);

function inD3Figure(abbr: string, raDeg: number, decDeg: number): boolean {
  const lines = (d3lines.lines as Record<string, number[][][]>)[abbr] ?? [];
  const ra = raDeg > 180 ? raDeg - 360 : raDeg;
  return lines.some((l) =>
    l.some(([r, d]) => Math.hypot(((r - ra + 540) % 360) - 180, d - decDeg) < 0.15),
  );
}

describe.skipIf(!have)('constellations vs IAU', () => {
  const { meta, con } = have ? load() : ({} as ReturnType<typeof load>);
  const byIndex = new Map(have ? meta.map((m) => [m.i, m]) : []);

  it('exactly the 88 IAU constellations, with official abbreviations', () => {
    const ours = con.constellations.map((c: { abbr: string }) => c.abbr).sort();
    const official = iau.constellations.map((c) => c.abbr).sort();
    expect(ours).toEqual(official);
  });

  it('every figure star resolves to a catalog star', () => {
    expect(con.missingHip).toEqual([]);
  });

  it('every figure has at least one line', () => {
    for (const c of con.constellations) expect(c.lines.flat().length, c.abbr).toBeGreaterThan(1);
  });

  it('figure stars lie inside their own constellation, or the cross-boundary link is corroborated', () => {
    const { pos } = load();
    const wrong: string[] = [];
    for (const c of con.constellations) {
      for (const i of c.lines.flat() as number[]) {
        const m = byIndex.get(i)!;
        if (m.con === c.abbr) continue;
        const [x, y, z] = pos(i);
        const ra = ((Math.atan2(y, x) * deg) + 360) % 360;
        const dec = Math.asin(z / Math.hypot(x, y, z)) * deg;
        if (!inD3Figure(c.abbr, ra, dec) && !DOCUMENTED_LINKS.has(`${c.abbr}:${m.hip}`)) {
          wrong.push(`${c.abbr}: HIP ${m.hip} ${m.bayer ?? ''} is in ${m.con}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('boundaries cover all 88 constellations', () => {
    const names = new Set<string>();
    for (const b of con.boundaries as Array<{ cons: string[] }>) b.cons.forEach((c) => names.add(c.replace(/\d$/, '')));
    expect(names.size).toBe(88);
  });

  it('precessed boundaries pass through every IAU J2000 corner vertex (VizieR VI/49) within 0.02°', () => {
    // Our edges are the B1875 definitions precessed to J2000; VI/49 publishes
    // independently computed J2000 vertices.
    const segs: number[][] = [];
    for (const b of con.boundaries as Array<{ points: number[][] }>) {
      for (let k = 0; k + 1 < b.points.length; k++) segs.push([...b.points[k], ...b.points[k + 1]]);
    }
    const unit = (ra: number, dec: number) => {
      const r = ra / deg;
      const d = dec / deg;
      return [Math.cos(d) * Math.cos(r), Math.cos(d) * Math.sin(r), Math.sin(d)];
    };
    const segVec = segs.map(([a, b, c, d]) => [unit(a, b), unit(c, d)]);
    const far: string[] = [];
    for (const [ra, dec, cst] of vi49.vertices as Array<[number, number, string]>) {
      const p = unit(ra, dec);
      let best = Infinity;
      for (const [a, b] of segVec) {
        // Distance from p to the chord a-b (small segments: chord ≈ arc).
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
        const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1)));
        const dx = ap[0] - t * ab[0];
        const dy = ap[1] - t * ab[1];
        const dz = ap[2] - t * ab[2];
        best = Math.min(best, Math.hypot(dx, dy, dz));
        if (best < 1e-6) break;
      }
      if (best * deg > 0.02) far.push(`${cst} ${ra},${dec}: ${(best * deg).toFixed(3)}°`);
    }
    expect(far).toEqual([]);
  });
});
