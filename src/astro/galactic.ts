// Galactic coordinates and the Sun's place in the Milky Way.
//
// Galactic frame (IAU 1958, J2000/ICRS realization, e.g. ESA 1997 Hipparcos
// Vol. 1 §1.5.3): north galactic pole at RA 192.85948°, Dec +27.12825°; the
// longitude zero point makes the galactic center direction (l = 0, b = 0) lie
// at RA 266.40499°, Dec −28.93617°.
//
// Distance to the Galactic Center R0 = 8.178 kpc (GRAVITY Collaboration 2019,
// A&A 625, L10); the Sun is z☉ = 20.8 pc above the midplane (Bennett & Bovy
// 2019, MNRAS 482, 1417). Sgr A* at RA 266.41684°, Dec −29.00781° (Reid &
// Brunthaler 2004).

import { DEG, KPC, PC } from './units.ts';
import { add, cross, dot, fromRaDec, normalize, scale, sub, type Mat3, type Vec3 } from './vec.ts';

export const NGP_RA = 192.85948;
export const NGP_DEC = 27.12825;
export const GC_RA = 266.40499;
export const GC_DEC = -28.93617;
export const SGRA_RA = 266.41684;
export const SGRA_DEC = -29.00781;

export const R0 = 8.178 * KPC;
export const Z_SUN = 20.8 * PC;

/** North galactic pole (unit vector, EQJ). */
export const NGP: Vec3 = fromRaDec(NGP_RA * DEG, NGP_DEC * DEG);
/** Galactic center direction l = 0, b = 0 (unit vector, EQJ). */
export const GC_DIR: Vec3 = fromRaDec(GC_RA * DEG, GC_DEC * DEG);
/** Direction to Sgr A* (unit vector, EQJ). */
export const SGRA_DIR: Vec3 = fromRaDec(SGRA_RA * DEG, SGRA_DEC * DEG);

/**
 * EQJ -> galactic (x toward l=0, y toward l=90°, z toward the NGP), row-major.
 * Rows are the galactic basis vectors expressed in EQJ.
 */
export const EQJ_TO_GAL: Mat3 = (() => {
  const x = GC_DIR;
  const z = NGP;
  const y = normalize(cross(z, x));
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
})();

/** Galactic longitude/latitude (degrees) of an EQJ direction. */
export function toGalactic(v: Vec3): { l: number; b: number } {
  const m = EQJ_TO_GAL;
  const x = m[0] * v[0] + m[1] * v[1] + m[2] * v[2];
  const y = m[3] * v[0] + m[4] * v[1] + m[5] * v[2];
  const z = m[6] * v[0] + m[7] * v[1] + m[8] * v[2];
  const r = Math.hypot(x, y, z);
  let l = Math.atan2(y, x) / DEG;
  if (l < 0) l += 360;
  return { l, b: Math.asin(z / r) / DEG };
}

/**
 * Galactocentric frame used for the galaxy model (units: kpc):
 * origin at Sgr A*; +Z toward the north side of the disk, tilted so that the
 * Sun sits Z_SUN above the midplane; +X from the center toward the Sun's
 * projection. Galactic rotation is clockwise seen from +Z.
 */
export interface GalaxyFrame {
  /** Galactic center, heliocentric EQJ meters. */
  center: Vec3;
  /** Unit axes in EQJ. */
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

export function galaxyFrame(): GalaxyFrame {
  const center = scale(SGRA_DIR, R0);
  // Unit vector from the Galactic Center to the Sun.
  const s = normalize(scale(center, -1));
  // Pole: NGP with its component along s removed, then tilted toward the Sun
  // so that the Sun sits exactly Z_SUN above the midplane through Sgr A*.
  const n0 = normalize(sub(NGP, scale(s, dot(NGP, s))));
  const sinT = Z_SUN / R0;
  const zAxis = normalize(add(scale(n0, Math.sqrt(1 - sinT * sinT)), scale(s, sinT)));
  const xAxis = normalize(sub(s, scale(zAxis, dot(s, zAxis))));
  const yAxis = normalize(cross(zAxis, xAxis));
  return { center, x: xAxis, y: yAxis, z: zAxis };
}
