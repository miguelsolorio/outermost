// Per-frame evaluation of every body's state in heliocentric ICRF meters.
// Float64 throughout: even Neptune's position keeps sub-millimeter precision.

import * as A from 'astronomy-engine';
import { tryState } from '../astro/ephemeris.ts';
import { orientationMatrix } from '../astro/orientation.ts';
import { add, length, normalize, sub, type Mat3, type Vec3 } from '../astro/vec.ts';
import { BODIES, BODY_BY_ID, type BodyDef } from './catalog.ts';

export interface BodyState {
  def: BodyDef;
  /** Heliocentric position (m, EQJ). */
  pos: Vec3;
  /** Position relative to parent (m). */
  relPos: Vec3;
  /** Velocity relative to parent (m/s). */
  relVel: Vec3;
  /** Body-fixed -> EQJ rotation. */
  orient: Mat3;
  /** Distance from the Sun's center (m). */
  sunDist: number;
  /** False when there is no ephemeris data at this time (e.g. before launch). */
  valid: boolean;
}

export class World {
  readonly states = new Map<string, BodyState>();
  time: A.AstroTime = A.MakeTime(new Date());
  ms = 0;

  constructor() {
    for (const def of BODIES) {
      this.states.set(def.id, {
        def,
        pos: [0, 0, 0],
        relPos: [0, 0, 0],
        relVel: [0, 0, 0],
        orient: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        sunDist: 0,
        valid: true,
      });
    }
  }

  update(ms: number): void {
    this.ms = ms;
    this.time = A.MakeTime(new Date(ms));
    // BODIES is ordered parents-first.
    for (const def of BODIES) {
      const st = this.states.get(def.id)!;
      const parent = def.parent ? this.states.get(def.parent)! : null;
      const rel = tryState(def.ephem, this.time);
      st.valid = !!rel && (!parent || parent.valid);
      if (!rel || !st.valid) {
        // Keep the last position (or the parent's) so nothing downstream sees NaN.
        if (parent) st.pos = parent.pos;
        continue;
      }
      const parentPos = parent ? parent.pos : ([0, 0, 0] as Vec3);
      st.relPos = rel.pos;
      st.relVel = rel.vel;
      st.pos = add(parentPos, rel.pos);
      st.sunDist = length(st.pos);
      const toParent = def.parent ? normalize(sub(parentPos, st.pos)) : undefined;
      st.orient = orientationMatrix(def.orient, this.time, toParent);
    }
  }

  get(id: string): BodyState {
    const s = this.states.get(id);
    if (!s) throw new Error(`Unknown body ${id}`);
    return s;
  }

  has(id: string): boolean {
    return BODY_BY_ID.has(id);
  }
}
