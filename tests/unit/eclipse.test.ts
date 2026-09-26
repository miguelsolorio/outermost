import { describe, expect, it } from 'vitest';
import { diskOverlap, limbFluxWithin, SOLAR_DISKS, solarDisks, sunBlocked } from '../../src/scene/eclipse.ts';
import { SUN_LIMB } from '../../src/scene/sunLimb.ts';
import { ECLIPSE_UNIFORMS, eclipseChunk } from '../../src/scene/shaders/eclipse.ts';
import { planetFragment } from '../../src/scene/shaders/planet.ts';
import { atmosphereFragment } from '../../src/scene/shaders/atmosphere.ts';

const CH = ['r', 'g', 'b'] as const;
const I = (a: number[], mu: number) => a.reduce((s, c, k) => s + c * mu ** k, 0);

/** Blocked fraction by direct integration: covered arc of each thin ring × its brightness. */
function reference(a: number, s: number, limb: number[], m = 2000): number {
  let blocked = 0;
  let total = 0;
  for (let j = 0; j < m; j++) {
    // Midpoints in μ, so the steep limb is sampled finely.
    const mu = (j + 0.5) / m;
    const r = Math.sqrt(1 - mu * mu);
    let arc: number;
    if (s === 0) arc = r < a ? 1 : 0;
    else if (s + r <= a) arc = 1;
    else if (r + a <= s || r >= s + a) arc = 0;
    else arc = Math.acos(Math.min(1, Math.max(-1, (r * r + s * s - a * a) / (2 * r * s)))) / Math.PI;
    const dF = I(limb, mu) * mu; // I · 2r dr = I · 2μ dμ
    blocked += dF * arc;
    total += dF;
  }
  return blocked / total;
}

describe('limb-darkened eclipse coverage', () => {
  it('the closed-form flux matches direct integration', () => {
    for (const ch of CH) {
      let num = 0;
      const m = 20000;
      for (let j = 0; j < m; j++) {
        const mu = (j + 0.5) / m;
        num += 2 * I(SUN_LIMB[ch], mu) * mu / m;
      }
      expect(limbFluxWithin(SUN_LIMB[ch], 1)).toBeCloseTo(num, 6);
    }
  });

  it('weights are non-negative and a covered Sun is fully blocked', () => {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      SOLAR_DISKS.rho.forEach((r, i) => {
        expect(SOLAR_DISKS.w[i][c]).toBeGreaterThanOrEqual(0);
        sum += SOLAR_DISKS.w[i][c] * Math.PI * r * r;
      });
      expect(sum).toBeCloseTo(1, 12);
    }
    expect(SOLAR_DISKS.rho.at(-1)).toBe(1);
    expect(sunBlocked(1.5, 0)).toEqual([1, 1, 1]);
    // Just past the shortcut, the stacked disks agree.
    for (const x of sunBlocked(1.03, 0.0300001)) expect(x).toBeCloseTo(1, 6);
  });

  it('reduces to the uniform-disk overlap for an unlimb-darkened Sun', () => {
    const flat = solarDisks(12, { r: [1], g: [1], b: [1] });
    for (const [a, s] of [[0.3, 0.5], [1.03, 0.9], [0.95, 0.02], [3, 3.5]]) {
      const expected = diskOverlap(1, a, s) / Math.PI;
      for (const x of sunBlocked(a, s, flat)) expect(Math.abs(x - expected)).toBeLessThan(1e-12);
    }
  });

  it('matches a direct integral over the limb-darkened disk', () => {
    for (const a of [0.3, 0.95, 1, 1.03, 1.06, 3, 7]) {
      // A sweep across the whole Sun, plus finer steps just past the inner
      // contact, where the last thin crescent of limb light remains.
      const seps = Array.from({ length: 150 }, (_, i) => (i * (a + 1)) / 150);
      for (let k = 1; k <= 20; k++) seps.push(Math.abs(a - 1) + k * 0.0025);
      for (const s of seps) {
        const got = sunBlocked(a, s);
        CH.forEach((ch, c) => {
          const ref = reference(a, s, SUN_LIMB[ch]);
          expect(Math.abs(got[c] - ref), `a=${a} s=${s.toFixed(4)} ${ch}`).toBeLessThan(0.005);
          const vis = 1 - ref;
          if (vis > 1e-4 && vis < 0.05) expect(Math.abs(1 - got[c] - vis) / vis, `a=${a} s=${s.toFixed(4)} ${ch} rel`).toBeLessThan(0.1);
        });
      }
    }
  });

  it('blocks more at the bright center and less at the dim limb than a uniform disk would', () => {
    expect(sunBlocked(0.1, 0)[1]).toBeGreaterThan(1.15 * 0.01);
    expect(sunBlocked(0.1, 0.95)[1]).toBeLessThan(diskOverlap(1, 0.1, 0.95) / Math.PI);
  });

  it('the last light before totality and an annular ring are reddened; first contact dims red first', () => {
    const vis = (a: number, s: number) => sunBlocked(a, s).map((x) => 1 - x);
    for (const [a, s] of [[1.03, 0.04], [0.95, 0]]) {
      const [r, g, b] = vis(a, s);
      expect(r).toBeGreaterThan(g);
      expect(g).toBeGreaterThan(b);
    }
    const [r, , b] = vis(1.03, 1.9);
    expect(b).toBeGreaterThan(r);
  });

  it('never gets darker as the occluder moves off the Sun', () => {
    for (const a of [0.5, 0.95, 1.03, 4]) {
      let prev = sunBlocked(a, 0);
      for (let s = 0.001; s < a + 1.1; s += 0.001) {
        const cur = sunBlocked(a, s);
        for (let c = 0; c < 3; c++) expect(cur[c]).toBeLessThanOrEqual(prev[c] + 1e-12);
        prev = cur;
      }
    }
  });
});

describe('eclipse shader chunk', () => {
  it('declares every shared uniform', () => {
    for (const name of ECLIPSE_UNIFORMS) expect(eclipseChunk).toMatch(new RegExp(`uniform \\w+ ${name}\\b`));
  });

  it('is included once, before the atmosphere that samples it', () => {
    for (const src of [planetFragment, atmosphereFragment]) {
      expect(src.match(/uniform vec3 sunPos;/g)).toHaveLength(1);
      expect(src.indexOf('vec4 sunVisibility(')).toBeGreaterThan(0);
      expect(src.indexOf('vec4 sunVisibility(')).toBeLessThan(src.indexOf('void atmScatter('));
    }
  });
});
