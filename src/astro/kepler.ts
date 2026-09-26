// Two-body (Keplerian) motion from osculating elements.

import { OBLIQUITY_J2000 } from './units.ts';
import type { Vec3 } from './vec.ts';

export interface Elements {
  /** Semi-major axis (AU). */
  a: number;
  e: number;
  /** Inclination, longitude of the ascending node, argument of perihelion (rad, ecliptic J2000). */
  i: number;
  om: number;
  w: number;
  /** Mean anomaly at the epoch (rad) and mean motion (rad/day). */
  M0: number;
  n: number;
  H: number;
}

const cosE = Math.cos(OBLIQUITY_J2000);
const sinE = Math.sin(OBLIQUITY_J2000);

/** Heliocentric position (AU, equatorial J2000 / EQJ axes) `days` after the elements' epoch. */
export function keplerPosition(el: Elements, days: number): Vec3 {
  const M = (((el.M0 + el.n * days) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let E = el.e > 0.8 ? Math.PI : M;
  for (let k = 0; k < 30; k++) {
    const d = (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  const xv = el.a * (Math.cos(E) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
  const cO = Math.cos(el.om);
  const sO = Math.sin(el.om);
  const cw = Math.cos(el.w);
  const sw = Math.sin(el.w);
  const ci = Math.cos(el.i);
  const si = Math.sin(el.i);
  const x = (cO * cw - sO * sw * ci) * xv + (-cO * sw - sO * cw * ci) * yv;
  const y = (sO * cw + cO * sw * ci) * xv + (-sO * sw + cO * cw * ci) * yv;
  const z = sw * si * xv + cw * si * yv;
  // Ecliptic J2000 -> equatorial J2000.
  return [x, cosE * y - sinE * z, sinE * y + cosE * z];
}

/** Diameter (km) from absolute magnitude H for an assumed geometric albedo. */
export const diameterFromH = (H: number, albedo: number): number => (1329 / Math.sqrt(albedo)) * 10 ** (-H / 5);

/** Parse the SMB1 binary written by tools/pipeline/steps/smallbodies.ts. */
export function parseSmallBodies(buf: ArrayBuffer): { epochJd: number; count: number; data: Float32Array; classes: Uint8Array } {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SMB1') throw new Error('not an SMB1 file');
  const count = dv.getUint32(4, true);
  return { epochJd: dv.getFloat64(8, true), count, data: new Float32Array(buf, 16, count * 8), classes: new Uint8Array(buf, 16 + count * 32, count) };
}

export function elementsAt(data: Float32Array, i: number): Elements {
  const o = i * 8;
  return { a: data[o], e: data[o + 1], i: data[o + 2], om: data[o + 3], w: data[o + 4], M0: data[o + 5], n: data[o + 6], H: data[o + 7] };
}
