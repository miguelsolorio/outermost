// Ephemeris providers. Each returns a geometric state vector (meters, m/s)
// in ICRF/EQJ axes relative to the body's parent (the Sun for planets).
// Accuracy: astronomy-engine agrees with JPL/NOVAS to about 1 arcminute.

import * as A from 'astronomy-engine';
import { AU } from './units.ts';
import type { Vec3 } from './vec.ts';
import { fittedPosition, type FittedElements } from './satellites.ts';
import { tableState } from './tables.ts';

const AU_PER_DAY = AU / 86_400;

export type EphemerisModel =
  | { type: 'origin' }
  /** Heliocentric position from astronomy-engine (VSOP87 / Pluto integration). */
  | { type: 'helio'; body: A.Body }
  /** Geocentric Moon (astronomy-engine, based on Chapront ELP/MPP02 truncation). */
  | { type: 'geomoon' }
  /** Galilean moons relative to Jupiter (astronomy-engine, L1.2 theory). */
  | { type: 'jupiterMoon'; moon: 'io' | 'europa' | 'ganymede' | 'callisto' }
  /** Mean elements refit to JPL Horizons (planet-centered). */
  | { type: 'fitted'; elements: FittedElements }
  /**
   * Horizons state table (Hermite-interpolated). With `companion`, the table is a
   * system barycenter and the body is offset by −ratio × the companion's orbit
   * (Pluto around the Pluto–Charon barycenter). Falls back when not loaded.
   */
  | { type: 'table'; id: string; fallback?: EphemerisModel; companion?: { elements: FittedElements; ratio: number } };

export interface State {
  pos: Vec3;
  vel: Vec3;
}

function fromStateVector(s: A.StateVector): State {
  return {
    pos: [s.x * AU, s.y * AU, s.z * AU],
    vel: [s.vx * AU_PER_DAY, s.vy * AU_PER_DAY, s.vz * AU_PER_DAY],
  };
}

/** Per-frame memo so several bodies sharing a computation (Galilean moons) pay once. */
let jupiterCache: { tt: number; info: A.JupiterMoonsInfo } | null = null;

export function stateRelativeToParent(model: EphemerisModel, time: A.AstroTime): State {
  const s = tryState(model, time);
  return s ?? { pos: [NaN, NaN, NaN], vel: [0, 0, 0] };
}

/** State, or null when the body has no data at this time (e.g. before a launch). */
export function tryState(model: EphemerisModel, time: A.AstroTime): State | null {
  switch (model.type) {
    case 'origin':
      return { pos: [0, 0, 0], vel: [0, 0, 0] };
    case 'helio':
      return fromStateVector(A.HelioState(model.body, time));
    case 'geomoon':
      return fromStateVector(A.GeoMoonState(time));
    case 'jupiterMoon': {
      if (!jupiterCache || jupiterCache.tt !== time.tt) {
        jupiterCache = { tt: time.tt, info: A.JupiterMoons(time) };
      }
      return fromStateVector(jupiterCache.info[model.moon]);
    }
    case 'fitted': {
      const { pos, vel } = fittedPosition(model.elements, time.tt + 2_451_545.0);
      return { pos: [pos[0] * 1e3, pos[1] * 1e3, pos[2] * 1e3], vel: [vel[0] * 1e3, vel[1] * 1e3, vel[2] * 1e3] };
    }
    case 'table': {
      const jd = time.tt + 2_451_545.0;
      const s = tableState(model.id, jd);
      if (!s) return model.fallback ? tryState(model.fallback, time) : null;
      const pos: Vec3 = [s.pos[0] * 1e3, s.pos[1] * 1e3, s.pos[2] * 1e3];
      const vel: Vec3 = [s.vel[0] * 1e3, s.vel[1] * 1e3, s.vel[2] * 1e3];
      if (model.companion) {
        const c = fittedPosition(model.companion.elements, jd);
        const k = model.companion.ratio * 1e3;
        for (let i = 0; i < 3; i++) {
          pos[i] -= k * c.pos[i];
          vel[i] -= k * c.vel[i];
        }
      }
      return { pos, vel };
    }
  }
}
