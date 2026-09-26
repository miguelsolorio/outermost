// How much sunlight a disk (a moon or planet) blocks, for eclipse shading.
//
// The Sun is limb-darkened: dimmer and redder toward its edge (Neckel & Labs
// 1994, via sunLimb.ts). With the brightness taken as constant within each of
// N rings, the solar disk is a stack of N concentric uniform disks, disk i of
// radius ρᵢ carrying the step in mean brightness between ring i and ring i+1.
// The light a disk blocks is then Σ wᵢ · overlap(ρᵢ, occluder), each overlap
// the two-disk area of Mandel & Agol (2002). The outermost disk is the solar
// disk itself, so contact times are exact, and the result is smooth in the
// separation. Rings are spaced in equal steps of μ = cos(angle from disk
// center), densest near the limb, where brightness changes fastest and where
// the last light before totality comes from.
//
// Angles are in solar radii: a = occluder radius / Sun radius, s = separation
// of the centers / Sun radius. The GLSL twin lives in shaders/eclipse.ts.

import { SUN_LIMB } from './sunLimb.ts';
import type { Vec3 } from '../astro/vec.ts';

type Rgb = [number, number, number];

export interface SolarDisks {
  /** Radii of the stacked disks, in solar radii; the last is 1. */
  rho: number[];
  /** Weight of each disk per channel: blocked fraction = Σ w · overlap area. */
  w: Rgb[];
}

/** Area of overlap of two disks (radii r1, r2, centers d apart). */
export function diskOverlap(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos(Math.min(1, Math.max(-1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))));
  const b = r2 * r2 * Math.acos(Math.min(1, Math.max(-1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))));
  const c = 0.5 * Math.sqrt(Math.max((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2), 0));
  return a + b - c;
}

/**
 * Light from inside fractional radius x of a disk with I(μ)/I(1) = Σ aₖ μᵏ,
 * in units of π·I(1): ∫₀ˣ I 2r dr = Σ aₖ · 2/(k+2) · (1 − (1−x²)^((k+2)/2)).
 */
export function limbFluxWithin(a: readonly number[], x: number): number {
  const u = Math.max(0, 1 - x * x);
  let f = 0;
  for (let k = 0; k < a.length; k++) f += (a[k] * 2) / (k + 2) * (1 - u ** ((k + 2) / 2));
  return f;
}

/** The limb-darkened Sun as n stacked uniform disks, rings equally spaced in μ. */
export function solarDisks(n: number, limb: { r: readonly number[]; g: readonly number[]; b: readonly number[] } = SUN_LIMB): SolarDisks {
  const rho = Array.from({ length: n }, (_, i) => Math.sqrt(1 - (1 - (i + 1) / n) ** 2));
  const channel = (a: readonly number[]): number[] => {
    const total = limbFluxWithin(a, 1);
    // Mean brightness of each ring.
    const mean = rho.map((r, i) => {
      const r0 = i > 0 ? rho[i - 1] : 0;
      return (limbFluxWithin(a, r) - limbFluxWithin(a, r0)) / (r * r - r0 * r0);
    });
    // Disk i carries the drop from ring i to ring i+1, normalized to the whole Sun.
    return mean.map((m, i) => (m - (i + 1 < n ? mean[i + 1] : 0)) / (Math.PI * total));
  };
  const r = channel(limb.r);
  const g = channel(limb.g);
  const b = channel(limb.b);
  return { rho, w: rho.map((_, i) => [r[i], g[i], b[i]]) };
}

export const SOLAR_DISKS = solarDisks(12);

/** Fraction of sunlight (r, g, b) blocked by a disk of radius a whose center is s from the Sun's (solar radii). */
export function sunBlocked(a: number, s: number, disks: SolarDisks = SOLAR_DISKS): Rgb {
  if (s <= a - 1) return [1, 1, 1];
  const out: Rgb = [0, 0, 0];
  for (let i = 0; i < disks.rho.length; i++) {
    const o = diskOverlap(disks.rho[i], a, s);
    for (let c = 0; c < 3; c++) out[c] += disks.w[i][c] * o;
  }
  return out.map((x) => Math.min(1, Math.max(0, x))) as Rgb;
}

/** Fraction of sunlight (r, g, b) reaching point p past a spherical occluder. */
export function sunVisibleFrom(p: Vec3, sun: Vec3, rSun: number, occ: Vec3, rOcc: number): Rgb {
  const S: Vec3 = [sun[0] - p[0], sun[1] - p[1], sun[2] - p[2]];
  const O: Vec3 = [occ[0] - p[0], occ[1] - p[1], occ[2] - p[2]];
  const dS = Math.hypot(...S);
  const dO = Math.hypot(...O);
  if (dO <= rOcc || dO >= dS) return [1, 1, 1];
  const aS = Math.asin(rSun / dS);
  const aO = Math.asin(rOcc / dO);
  const chord = Math.hypot(S[0] / dS - O[0] / dO, S[1] / dS - O[1] / dO, S[2] / dS - O[2] / dO);
  const sep = 2 * Math.asin(Math.min(1, chord / 2));
  const b = sunBlocked(aO / aS, sep / aS);
  return [1 - b[0], 1 - b[1], 1 - b[2]];
}

/**
 * Whether an occluder's penumbra can reach a sphere (a body plus its
 * atmosphere). The penumbral cone widens behind the occluder by (R☉ + r)/D per
 * unit depth. Positions share one frame; radii in the same units.
 */
export function penumbraReaches(sun: Vec3, rSun: number, occ: Vec3, rOcc: number, body: Vec3, rBody: number): boolean {
  const ax: Vec3 = [occ[0] - sun[0], occ[1] - sun[1], occ[2] - sun[2]];
  const D = Math.hypot(...ax);
  const u: Vec3 = [ax[0] / D, ax[1] / D, ax[2] / D];
  const w: Vec3 = [body[0] - occ[0], body[1] - occ[1], body[2] - occ[2]];
  const z = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
  // Entirely on the Sun's side of the occluder.
  if (z + rBody < -rOcc) return false;
  const lateral = Math.hypot(w[0] - z * u[0], w[1] - z * u[1], w[2] - z * u[2]);
  const cone = rOcc + (Math.max(z + rBody, 0) * (rSun + rOcc)) / D;
  return lateral - rBody < 1.01 * cone;
}
