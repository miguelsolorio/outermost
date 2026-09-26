// Earth satellites from two-line element sets, propagated with SGP4
// (satellite.js). SGP4 works in the TEME frame; we treat TEME as the true
// equator and equinox of date (they differ only by the equation of the
// equinoxes, < 1.2″, i.e. under 40 m at the ISS) and precess/nutate to EQJ.

import * as A from 'astronomy-engine';
import { propagate, twoline2satrec, type SatRec } from 'satellite.js';
import { eqdToEqjMatrix } from './orientation.ts';
import type { Mat3, Vec3 } from './vec.ts';

export class Sgp4Orbit {
  private rec: SatRec;
  /** TLE epoch (ms since 1970, UTC). */
  readonly epochMs: number;
  private rotCache: { ms: number; m: Mat3 } | null = null;

  constructor(
    readonly line1: string,
    readonly line2: string,
  ) {
    this.rec = twoline2satrec(line1, line2);
    this.epochMs = (this.rec.jdsatepoch - 2440587.5) * 86_400_000;
  }

  /** Geocentric position (km, EQJ axes), or null if propagation fails. */
  position(ms: number): Vec3 | null {
    const pv = propagate(this.rec, new Date(ms));
    const p = pv?.position;
    if (!p || typeof p === 'boolean' || !Number.isFinite(p.x)) return null;
    // Precession-nutation changes negligibly within a minute.
    if (!this.rotCache || Math.abs(this.rotCache.ms - ms) > 60_000) this.rotCache = { ms, m: eqdToEqjMatrix(A.MakeTime(new Date(ms))) };
    const m = this.rotCache.m;
    return [m[0] * p.x + m[1] * p.y + m[2] * p.z, m[3] * p.x + m[4] * p.y + m[5] * p.z, m[6] * p.x + m[7] * p.y + m[8] * p.z];
  }

  /** Orbital period (minutes) from the mean motion. */
  get periodMin(): number {
    return (2 * Math.PI) / this.rec.no;
  }
}
