// Fact-check black holes against the processed catalogs they sit in: host
// galaxy centers vs SIMBAD nuclei, the distance each mass was measured at vs
// the host's catalog distance (dynamical masses scale with it), and the Cygnus
// X-1 star override. Needs `npm run pipeline galaxies stars`.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEG } from '../../src/astro/units.ts';
import { BLACK_HOLES } from '../../src/data/blackHoles.ts';

const ASSETS = new URL('../../public/assets/', import.meta.url).pathname;
const haveGalaxies = existsSync(ASSETS + 'galaxies/local.json');
const haveStars = existsSync(ASSETS + 'stars/stars-meta.json');

const sepArcsec = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) => {
  const c = Math.sin(a.dec * DEG) * Math.sin(b.dec * DEG) + Math.cos(a.dec * DEG) * Math.cos(b.dec * DEG) * Math.cos((a.ra - b.ra) * DEG);
  return (Math.acos(Math.min(1, c)) / DEG) * 3600;
};

describe.skipIf(!haveGalaxies)('supermassive black holes in their host galaxies', () => {
  type G = { name: string; ra: number; dec: number; dist_mpc: number };
  const local = haveGalaxies ? (JSON.parse(readFileSync(ASSETS + 'galaxies/local.json', 'utf8')).galaxies as G[]) : [];
  const hosted = BLACK_HOLES.flatMap((b) => (b.placement.type === 'host' && b.placement.host.startsWith('gal-') ? [{ b, name: b.placement.host.slice(4) }] : []));

  it.each(hosted.map((h) => [h.b.id, h] as const))('%s: host galaxy is in the catalog, centered on the nucleus', (_, { b, name }) => {
    const g = local.find((x) => x.name === name);
    expect(g, name).toBeDefined();
    // Catalog centers are optical isophote centers; Centaurus A's is ~17″ off its radio core.
    expect(sepArcsec(g!, b.published)).toBeLessThan(20);
  });

  it.each(hosted.map((h) => [h.b.id, h] as const))('%s: mass measured within 10%% of the host catalog distance', (_, { b, name }) => {
    const g = local.find((x) => x.name === name)!;
    if (b.mass.atDistMpc === undefined) return;
    expect(Math.abs(b.mass.atDistMpc / g.dist_mpc - 1)).toBeLessThan(0.1);
  });
});

describe.skipIf(!haveStars)('Cygnus X-1 in the star catalog', () => {
  type M = { i: number; hip: number | null; name?: string; dist: number; absmag: number; lum: number; distSrc: string };
  const meta = haveStars ? (JSON.parse(readFileSync(ASSETS + 'stars/stars-meta.json', 'utf8')).stars as M[]) : [];

  it('HD 226868 is at the VLBA distance, 2.22 kpc (Miller-Jones et al. 2021), under its own name', () => {
    const s = meta.find((m) => m.hip === 98298)!;
    expect(s.dist).toBe(2220);
    expect(s.distSrc).toBe('override');
    expect(s.name).toBe('HD 226868');
  });

  it('every luminosity follows from its absolute magnitude, L = 10^((4.85 − M)/2.5)', () => {
    // Values are stored rounded (absmag to 0.01, lum to 0.001), hence the tolerance.
    const bad = meta.filter((m) => {
      const L = 10 ** ((4.85 - m.absmag) / 2.5);
      return Math.abs(m.lum - L) > Math.max(0.006 * L, 0.0015);
    });
    expect(bad.map((m) => `${m.name ?? m.hip}: ${m.lum} vs ${10 ** ((4.85 - m.absmag) / 2.5)}`)).toEqual([]);
  });
});
