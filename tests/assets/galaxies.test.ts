// Fact-check the processed galaxy catalogs. Needs `npm run pipeline galaxies`.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = new URL('../../public/assets/galaxies/', import.meta.url).pathname;
const have = existsSync(DIR + 'local.json');

type G = { name: string; ra: number; dec: number; dist_mpc: number };

function readBin(name: string): Float32Array[] {
  const b = readFileSync(DIR + name);
  const count = b.readUInt32LE(4);
  const stride = b.readUInt32LE(8);
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const o = 12 + i * stride;
    out.push(new Float32Array([b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)]));
  }
  return out;
}

describe.skipIf(!have)('Local Volume distances vs published values', () => {
  const local = have ? (JSON.parse(readFileSync(DIR + 'local.json', 'utf8')).galaxies as G[]) : [];
  const find = (n: string) => local.find((g) => g.name === n)!;
  const cases: Array<[string, number, number, string]> = [
    ['MESSIER031', 0.765, 0.05, 'Andromeda ~765 kpc (e.g. Li et al. 2021: 761 ± 11 kpc)'],
    ['MESSIER033', 0.84, 0.1, 'Triangulum ~840 kpc'],
    ['LMC', 0.04959, 0.02, 'LMC 49.59 kpc (Pietrzyński et al. 2019)'],
    ['SMC', 0.06244, 0.03, 'SMC 62.44 kpc (Graczyk et al. 2020)'],
  ];
  for (const [name, ref, tol, note] of cases) {
    it(note, () => {
      const g = find(name);
      expect(g, name).toBeDefined();
      expect(Math.abs(g.dist_mpc / ref - 1)).toBeLessThan(tol);
    });
  }
  it('each galaxy appears once (no duplicate LMC/SMC from merged catalogs)', () => {
    for (const n of ['LMC', 'SMC', 'MESSIER031']) expect(local.filter((g) => g.name === n).length, n).toBe(1);
  });
});

describe.skipIf(!have)('redshift surveys', () => {
  it('2MRS: ~44k galaxies, with the Virgo Cluster as a clear overdensity near 16 Mpc', () => {
    const g = readBin('2mrs.bin');
    expect(g.length).toBeGreaterThan(40_000);
    // M87 direction.
    const ra = (187.706 * Math.PI) / 180;
    const dec = (12.391 * Math.PI) / 180;
    const u = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
    const within = (deg: number, dmin: number, dmax: number, dir = u) =>
      g.filter((p) => {
        const r = Math.hypot(p[0], p[1], p[2]);
        const c = (p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]) / r;
        return r > dmin && r < dmax && c > Math.cos((deg * Math.PI) / 180);
      }).length;
    const virgo = within(6, 8, 30);
    // Same cone pointed at the opposite sky: far fewer galaxies.
    const anti = within(6, 8, 30, [-u[0], -u[1], -u[2]]);
    expect(virgo).toBeGreaterThan(3 * anti);
  });
  it('SDSS galaxies and quasars reach the expected depths', () => {
    const maxR = (list: Float32Array[]) => list.reduce((m, p) => Math.max(m, Math.hypot(p[0], p[1], p[2])), 0);
    expect(maxR(readBin('sdss.bin'))).toBeGreaterThan(2500); // z = 0.8 ≈ 2,900 Mpc comoving
    expect(maxR(readBin('qso.bin'))).toBeGreaterThan(7000); // z = 5 ≈ 8,000 Mpc comoving
  });
});
