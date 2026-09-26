// Body orientation: the matrix taking body-fixed coordinates (planetocentric,
// +Z = IAU north pole, +X = prime meridian, east-positive longitude) into
// ICRF/J2000 equatorial (EQJ) coordinates.
//
// For most bodies this uses the IAU WGCCRE 2015 rotation model via
// astronomy-engine's RotationAxis (α0, δ0, W):
//   M = Rz(α0 + 90°) · Rx(90° − δ0) · Rz(W)       (active rotations)
// Earth instead uses Greenwich apparent sidereal time with IAU 2006/2000
// precession-nutation, which is what makes the terminator land on the right
// meridian to a few arcseconds.

import * as A from 'astronomy-engine';
import { DEG, HOUR_ANGLE } from './units.ts';
import { mat3Mul, rotX, rotZ, type Mat3, type Vec3 } from './vec.ts';

export type OrientationModel =
  | { type: 'iau'; body: A.Body }
  | { type: 'earth' }
  /** Pole fixed in EQJ with uniform rotation W = w0 + wd·d (degrees, d days from J2000 TDB≈UT). */
  | { type: 'fixed'; ra: number; dec: number; w0: number; wd: number }
  /** Synchronous rotation: prime meridian always faces the parent (mean). Needs the parent-relative state. */
  | { type: 'synchronous'; ra: number; dec: number };

/** Body-fixed -> EQJ from the IAU angles (all radians). */
export function iauMatrix(alpha0: number, delta0: number, w: number): Mat3 {
  return mat3Mul(mat3Mul(rotZ(alpha0 + Math.PI / 2), rotX(Math.PI / 2 - delta0)), rotZ(w));
}

function fromAxisInfo(info: A.AxisInfo): Mat3 {
  return iauMatrix(info.ra * HOUR_ANGLE, info.dec * DEG, info.spin * DEG);
}

/** Convert an astronomy-engine rotation into our row-major Mat3 by rotating basis vectors. */
function astroRotationToMat3(rot: A.RotationMatrix, time: A.AstroTime): Mat3 {
  const ex = A.RotateVector(rot, new A.Vector(1, 0, 0, time));
  const ey = A.RotateVector(rot, new A.Vector(0, 1, 0, time));
  const ez = A.RotateVector(rot, new A.Vector(0, 0, 1, time));
  // Columns are the images of the basis vectors.
  return [ex.x, ey.x, ez.x, ex.y, ey.y, ez.y, ex.z, ey.z, ez.z];
}

/** True equator and equinox of date -> EQJ (precession and nutation). */
export function eqdToEqjMatrix(time: A.AstroTime): Mat3 {
  return astroRotationToMat3(A.Rotation_EQD_EQJ(time), time);
}

/** Earth-fixed (ITRS, ignoring polar motion) -> EQJ. */
export function earthMatrix(time: A.AstroTime): Mat3 {
  const gast = A.SiderealTime(time) * HOUR_ANGLE; // true equinox of date
  const eqdToEqj = astroRotationToMat3(A.Rotation_EQD_EQJ(time), time);
  return mat3Mul(eqdToEqj, rotZ(gast));
}

export function orientationMatrix(model: OrientationModel, time: A.AstroTime, toParentDir?: Vec3): Mat3 {
  switch (model.type) {
    case 'iau':
      return fromAxisInfo(A.RotationAxis(model.body, time));
    case 'earth':
      return earthMatrix(time);
    case 'fixed':
      return iauMatrix(model.ra * DEG, model.dec * DEG, (model.w0 + model.wd * time.tt) * DEG);
    case 'synchronous': {
      const a0 = model.ra * DEG;
      const d0 = model.dec * DEG;
      if (!toParentDir) return iauMatrix(a0, d0, 0);
      // Choose W so the +X axis points as close as possible to the parent.
      const base = iauMatrix(a0, d0, 0);
      // Parent direction expressed in the W=0 body frame (transpose multiply).
      const px = base[0] * toParentDir[0] + base[3] * toParentDir[1] + base[6] * toParentDir[2];
      const py = base[1] * toParentDir[0] + base[4] * toParentDir[1] + base[7] * toParentDir[2];
      return iauMatrix(a0, d0, Math.atan2(py, px));
    }
  }
}

/**
 * Planetocentric east longitude / latitude (degrees) of a direction given in
 * EQJ, for a body with the given orientation matrix.
 */
export function bodyFixedLonLat(m: Mat3, dirEqj: Vec3): { lon: number; lat: number } {
  // Transpose (inverse rotation) to get body-fixed coordinates.
  const x = m[0] * dirEqj[0] + m[3] * dirEqj[1] + m[6] * dirEqj[2];
  const y = m[1] * dirEqj[0] + m[4] * dirEqj[1] + m[7] * dirEqj[2];
  const z = m[2] * dirEqj[0] + m[5] * dirEqj[1] + m[8] * dirEqj[2];
  const r = Math.hypot(x, y, z);
  return { lon: Math.atan2(y, x) / DEG, lat: Math.asin(z / r) / DEG };
}
