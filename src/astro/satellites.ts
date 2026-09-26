// Moon positions from JPL mean orbital elements (epoch 2000-01-01.5 TDB).
// Elements are referred to each moon's Laplace plane (pole RA/Dec given) or to
// the planet's equator. The node is measured from the ascending node of that
// reference plane on the ICRF equator; the argument of periapsis from the
// node. The apsidal line advances with period Papsis and the node regresses
// with period Pnode; the mean longitude advances with the sidereal period P.
// JPL notes these are "not intended for ephemeris computation": they are good
// to about a degree for most major moons over a few decades (see the tests).

import { DEG } from './units.ts';
import { cross, normalize, type Vec3 } from './vec.ts';

export interface MeanElements {
  frame: 'Laplace' | 'equatorial' | 'ecliptic';
  a_km: number;
  e: number;
  w_deg: number;
  M_deg: number;
  i_deg: number;
  node_deg: number;
  P_days: number;
  Papsis_yr: number | null;
  Pnode_yr: number | null;
  laplace_ra_deg: number | null;
  laplace_dec_deg: number | null;
}

const J2000_JD_TDB = 2451545.0;

function solveKepler(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 20; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/**
 * Planet-centered position (km, ICRF) at Julian date `jdTdb`. For 'equatorial'
 * frames the planet's pole (unit ICRF vector) must be supplied.
 */
export function meanElementsPosition(el: MeanElements, jdTdb: number, planetPole?: Vec3): { pos: Vec3; vel: Vec3 } {
  const dt = jdTdb - J2000_JD_TDB; // days
  const yr = dt / 365.25;
  const node0 = el.node_deg * DEG;
  const varpi0 = (el.node_deg + el.w_deg) * DEG;
  const lambda0 = (el.node_deg + el.w_deg + el.M_deg) * DEG;
  const node = node0 - (el.Pnode_yr ? (2 * Math.PI * yr) / el.Pnode_yr : 0);
  const varpi = varpi0 + (el.Papsis_yr ? (2 * Math.PI * yr) / el.Papsis_yr : 0);
  const n = (2 * Math.PI) / el.P_days; // rad/day (sidereal)
  const lambda = lambda0 + n * dt;
  const w = varpi - node;
  const M = ((lambda - varpi) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const E = solveKepler(M, el.e);
  const a = el.a_km;
  const b = a * Math.sqrt(1 - el.e * el.e);
  // Perifocal coordinates.
  const xp = a * (Math.cos(E) - el.e);
  const yp = b * Math.sin(E);
  const Edot = n / (1 - el.e * Math.cos(E));
  const vxp = -a * Math.sin(E) * Edot;
  const vyp = b * Math.cos(E) * Edot;
  // Rotate perifocal -> reference plane (Ω, i, ω).
  const cO = Math.cos(node);
  const sO = Math.sin(node);
  const ci = Math.cos(el.i_deg * DEG);
  const si = Math.sin(el.i_deg * DEG);
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const r11 = cO * cw - sO * sw * ci;
  const r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci;
  const r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si;
  const r32 = cw * si;
  const pRef: Vec3 = [r11 * xp + r12 * yp, r21 * xp + r22 * yp, r31 * xp + r32 * yp];
  const vRef: Vec3 = [r11 * vxp + r12 * vyp, r21 * vxp + r22 * vyp, r31 * vxp + r32 * vyp];
  // Reference plane basis in ICRF: z = plane pole, x = its ascending node on the ICRF equator.
  let pole: Vec3;
  if (el.frame === 'Laplace' && el.laplace_ra_deg !== null && el.laplace_dec_deg !== null) {
    const ra = el.laplace_ra_deg * DEG;
    const dec = el.laplace_dec_deg * DEG;
    pole = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  } else if (el.frame === 'equatorial' && planetPole) {
    pole = planetPole;
  } else {
    // Ecliptic J2000.
    const eps = 23.4392911 * DEG;
    pole = [0, -Math.sin(eps), Math.cos(eps)];
  }
  const x = normalize(cross([0, 0, 1], pole));
  const y = cross(pole, x);
  const toIcrf = (v: Vec3): Vec3 => [
    x[0] * v[0] + y[0] * v[1] + pole[0] * v[2],
    x[1] * v[0] + y[1] * v[1] + pole[1] * v[2],
    x[2] * v[0] + y[2] * v[1] + pole[2] * v[2],
  ];
  return { pos: toIcrf(pRef), vel: toIcrf(vRef).map((c) => c / 86_400) as Vec3 };
}

/**
 * Mean elements refit to JPL Horizons over 1995–2045 (tools/bake/satellites.ts):
 * fixed a, e, i and pole; linear rates for the node, longitude of periapsis and
 * mean longitude (plus a quadratic term for Phobos' tidal acceleration).
 * Angles in radians, rates per day.
 */
export interface FittedElements {
  epoch_jd_tdb: number;
  pole_icrf: Vec3;
  a_km: number;
  e: number;
  i_rad: number;
  node_rad: number;
  node_rate: number;
  varpi_rad: number;
  varpi_rate: number;
  lambda_rad: number;
  lambda_rate: number;
  lambda_accel: number;
  /** Optional resonant libration of the mean longitude (Mimas). */
  lib_omega?: number;
  lib_sin?: number;
  lib_cos?: number;
}

export function fittedPosition(f: FittedElements, jdTdb: number): { pos: Vec3; vel: Vec3 } {
  const t = jdTdb - f.epoch_jd_tdb;
  const node = f.node_rad + f.node_rate * t;
  const varpi = f.varpi_rad + f.varpi_rate * t;
  const lib = f.lib_omega ? (f.lib_sin ?? 0) * Math.sin(f.lib_omega * t) + (f.lib_cos ?? 0) * Math.cos(f.lib_omega * t) : 0;
  const lambda = f.lambda_rad + f.lambda_rate * t + f.lambda_accel * t * t + lib;
  const n = f.lambda_rate + 2 * f.lambda_accel * t;
  const w = varpi - node;
  const M = ((lambda - varpi) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const E = solveKepler(M, f.e);
  const a = f.a_km;
  const b = a * Math.sqrt(1 - f.e * f.e);
  const xp = a * (Math.cos(E) - f.e);
  const yp = b * Math.sin(E);
  const Edot = n / (1 - f.e * Math.cos(E));
  const vxp = -a * Math.sin(E) * Edot;
  const vyp = b * Math.cos(E) * Edot;
  const cO = Math.cos(node);
  const sO = Math.sin(node);
  const ci = Math.cos(f.i_rad);
  const si = Math.sin(f.i_rad);
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const r11 = cO * cw - sO * sw * ci;
  const r12 = -cO * sw - sO * cw * ci;
  const r21 = sO * cw + cO * sw * ci;
  const r22 = -sO * sw + cO * cw * ci;
  const r31 = sw * si;
  const r32 = cw * si;
  const pole = f.pole_icrf;
  const x = normalize(cross([0, 0, 1], pole));
  const y = cross(pole, x);
  const toIcrf = (v: Vec3): Vec3 => [
    x[0] * v[0] + y[0] * v[1] + pole[0] * v[2],
    x[1] * v[0] + y[1] * v[1] + pole[1] * v[2],
    x[2] * v[0] + y[2] * v[1] + pole[2] * v[2],
  ];
  const pos = toIcrf([r11 * xp + r12 * yp, r21 * xp + r22 * yp, r31 * xp + r32 * yp]);
  const vel = toIcrf([r11 * vxp + r12 * vyp, r21 * vxp + r22 * vyp, r31 * vxp + r32 * vyp]).map((c) => c / 86_400) as Vec3;
  return { pos, vel };
}
