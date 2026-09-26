// Camera controller: logarithmic zoom, orbiting, tilt, and fly-to.
//
// The camera orbits a *pivot*. The pivot is a pure function of the focus
// chain (e.g. moon -> earth -> sun) and the camera distance r: as you zoom
// out past a body's neighborhood, the pivot slides smoothly to its parent, and
// zooming back in retraces the same path. Positions are float64 meters.

import {
  add,
  angleBetween,
  clamp,
  cross,
  dot,
  length,
  lerp,
  normalize,
  rotateAxisAngle,
  scale,
  slerp,
  smoothstep,
  sub,
  type Vec3,
} from '../../astro/vec.ts';
import { DEG, OBLIQUITY_J2000 } from '../../astro/units.ts';
import { EQJ_TO_GAL, galaxyFrame } from '../../astro/galactic.ts';

/** Something the camera can focus on. */
export interface FocusTarget {
  id: string;
  /** Mean radius (m). 0 for points. */
  radius: number;
  /** Closest allowed altitude above the surface (m). */
  minAltitude: number;
  /** Current position (heliocentric m). */
  pos(): Vec3;
  /** Unit north-pole vector, if meaningful. */
  pole(): Vec3 | null;
  /** Range of camera distance (m) over which the pivot hands off to the parent. */
  handoff: [number, number] | null;
  /** Parent id (for building chains). */
  parent: string | null;
  /** Preferred viewing distance when flying here (m); defaults to framing the radius. */
  framing?: number;
  /** Preferred direction from the target to the camera on arrival (default: lit side). */
  approach?: () => Vec3;
}

export type Resolver = (id: string) => FocusTarget | undefined;

/** Ecliptic north pole in EQJ. */
export const ECLIPTIC_NORTH: Vec3 = [0, -Math.sin(OBLIQUITY_J2000), Math.cos(OBLIQUITY_J2000)];

/** Three times the comoving distance to the CMB, so the whole observable universe fits in view. */
export const MAX_DISTANCE = 1.3e27;

/** Supergalactic north pole: galactic l = 47.37°, b = +6.32° (de Vaucouleurs). */
export const SUPERGALACTIC_NORTH: Vec3 = (() => {
  const l = 47.37 * DEG;
  const b = 6.32 * DEG;
  const g: Vec3 = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
  const m = EQJ_TO_GAL;
  return normalize([m[0] * g[0] + m[3] * g[1] + m[6] * g[2], m[1] * g[0] + m[4] * g[1] + m[7] * g[2], m[2] * g[0] + m[5] * g[1] + m[8] * g[2]]);
})();

/** Galactic north (the Milky Way model's +z), for "up" at galactic scales. */
export const GALACTIC_NORTH: Vec3 = galaxyFrame().z;

interface Flight {
  t: number;
  duration: number;
  fromChain: string[];
  fromR: number;
  toId: string;
  toR: number;
  dir0: Vec3;
  dir1: Vec3;
  tilt0: number;
  hump: number;
  onDone?: () => void;
}

export interface CameraPose {
  position: Vec3;
  pivot: Vec3;
  /** Unit vectors in world (EQJ) space. */
  forward: Vec3;
  up: Vec3;
  right: Vec3;
  /** Distance from pivot (m). */
  r: number;
}

const smootherstep = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export class CameraController {
  chain: string[] = ['earth', 'sun'];
  /** ln(altitude in m) above the focus surface. */
  logH = Math.log(2e7);
  logHTarget = this.logH;
  dir: Vec3 = normalize([0.3, -0.9, 0.3]);
  /** View tilt away from nadir (rad), Google Earth style. */
  tilt = 0;
  tiltTarget = 0;

  private azVel = 0;
  private elVel = 0;
  private zoomAnchor: Vec3 | null = null;
  private flight: Flight | null = null;
  pose: CameraPose = {
    position: [0, 0, 0],
    pivot: [0, 0, 0],
    forward: [0, 0, -1],
    up: [0, 1, 0],
    right: [1, 0, 0],
    r: 1,
  };

  constructor(private resolve: Resolver) {}

  get focusId(): string {
    return this.chain[0];
  }

  get focus(): FocusTarget {
    const f = this.resolve(this.focusId);
    if (!f) throw new Error(`No focus target ${this.focusId}`);
    return f;
  }

  get altitude(): number {
    return Math.exp(this.logH);
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  get minLogH(): number {
    return Math.log(Math.max(1, this.focus.minAltitude));
  }

  get maxLogH(): number {
    return Math.log(MAX_DISTANCE);
  }

  static chainFor(id: string, resolve: Resolver): string[] {
    const out: string[] = [];
    let cur: string | null = id;
    while (cur) {
      out.push(cur);
      cur = resolve(cur)?.parent ?? null;
    }
    return out;
  }

  /** Pivot position for a chain at camera distance r. */
  pivotFor(chain: string[], r: number): Vec3 {
    let p = this.resolve(chain[0])!.pos();
    const lr = Math.log(r);
    for (let i = 0; i + 1 < chain.length; i++) {
      const cur = this.resolve(chain[i]);
      const next = this.resolve(chain[i + 1]);
      if (!cur?.handoff || !next) break;
      const w = smoothstep(Math.log(cur.handoff[0]), Math.log(cur.handoff[1]), lr);
      if (w <= 0) break;
      p = lerp(p, next.pos(), w);
    }
    return p;
  }

  /** The chain member that dominates the view at the current distance (for titles). */
  dominantId(): string {
    const lr = Math.log(Math.max(this.pose.r, 1));
    let id = this.chain[0];
    for (let i = 0; i + 1 < this.chain.length; i++) {
      const cur = this.resolve(this.chain[i]);
      if (!cur?.handoff || !this.resolve(this.chain[i + 1])) break;
      if (lr < (Math.log(cur.handoff[0]) + Math.log(cur.handoff[1])) / 2) break;
      id = this.chain[i + 1];
    }
    return id;
  }

  /** View "up": the focus body's pole up close, ecliptic north farther out. */
  upFor(chain: string[], r: number): Vec3 {
    const f = this.resolve(chain[0])!;
    const pole = f.pole();
    let up = ECLIPTIC_NORTH;
    if (pole && f.radius > 0) up = normalize(slerp(pole, ECLIPTIC_NORTH, smoothstep(Math.log(20 * f.radius), Math.log(400 * f.radius), Math.log(r))));
    // Beyond the stars next door, orient to the Galaxy; beyond the Local
    // Group, to the supergalactic plane where nearby galaxies concentrate.
    up = normalize(slerp(up, GALACTIC_NORTH, smoothstep(Math.log(3e16), Math.log(3e19), Math.log(r))));
    return normalize(slerp(up, SUPERGALACTIC_NORTH, smoothstep(Math.log(3e22), Math.log(1e24), Math.log(r))));
  }

  distanceFor(chain: string[], logH: number): number {
    return (this.resolve(chain[0])?.radius ?? 0) + Math.exp(logH);
  }

  // ---- input ----------------------------------------------------------------

  /** Wheel/pinch zoom. `amount` > 0 zooms out. `anchorDir` is the surface direction under the cursor. */
  zoom(amount: number, anchorDir: Vec3 | null = null): void {
    if (this.flight) this.cancelFlight();
    this.logHTarget = clamp(this.logHTarget + amount, this.minLogH, this.maxLogH);
    this.zoomAnchor = amount < 0 ? anchorDir : null;
  }

  /** Orbit by a screen drag, in pixels, given the viewport height in pixels. */
  orbit(dx: number, dy: number, viewportH: number, fovRad: number): void {
    if (this.flight) this.cancelFlight();
    const r = this.pose.r;
    const h = this.altitude;
    const k = ((2 * fovRad) / viewportH) * clamp(h / r, 0.02, 1);
    this.applyOrbit(-dx * k, dy * k);
    // Remember velocity for inertia (per second, assuming ~60 Hz input).
    this.azVel = -dx * k * 60;
    this.elVel = dy * k * 60;
  }

  releaseOrbit(): void {
    // keep current velocity for inertia
  }

  stopInertia(): void {
    this.azVel = 0;
    this.elVel = 0;
  }

  /** Tilt the view toward the horizon (only near a surface). */
  tiltBy(dy: number, viewportH: number): void {
    this.tiltTarget = clamp(this.tiltTarget + (dy / viewportH) * 1.5, 0, this.maxTilt());
  }

  private maxTilt(): number {
    const f = this.resolve(this.focusId);
    if (!f || f.radius <= 0) return 0;
    // Allow tilting only when the surface fills the view.
    const h = this.altitude;
    return 70 * DEG * (1 - smoothstep(0.5 * f.radius, 3 * f.radius, h));
  }

  private applyOrbit(dAz: number, dEl: number): void {
    const up = this.upFor(this.chain, this.pose.r);
    this.dir = normalize(rotateAxisAngle(this.dir, up, dAz));
    const right = normalize(cross(up, this.dir));
    if (length(right) < 1e-9) return;
    const el = Math.asin(clamp(dot(this.dir, up), -1, 1));
    const newEl = clamp(el + dEl, -88 * DEG, 88 * DEG);
    this.dir = normalize(rotateAxisAngle(this.dir, right, -(newEl - el)));
  }

  // ---- fly-to -----------------------------------------------------------------

  /** Default viewing distance that frames a target nicely. */
  framingDistance(target: FocusTarget, fovRad: number): number {
    if (target.framing) return target.framing;
    if (target.radius <= 0) return 1e9;
    const r = target.radius / Math.sin(fovRad * 0.3);
    return Math.max(r, target.radius + target.minAltitude);
  }

  flyTo(id: string, fovRad: number, opts: { distance?: number; onDone?: () => void } = {}): void {
    const target = this.resolve(id);
    if (!target) return;
    const toR = opts.distance ?? this.framingDistance(target, fovRad);
    const fromR = this.pose.r;
    const p0 = this.pose.pivot;
    const p1 = target.pos();
    const d = length(sub(p1, p0));
    const dir1 = this.approachDirection(target, p0);
    const dLog = Math.abs(Math.log10(toR) - Math.log10(fromR));
    const duration = clamp(1.2 + 0.25 * dLog + 0.25 * Math.log10(1 + d / Math.max(fromR, toR)), 1.5, 7);
    this.flight = {
      t: 0,
      duration,
      fromChain: [...this.chain],
      fromR,
      toId: id,
      toR,
      dir0: this.dir,
      dir1,
      tilt0: this.tilt,
      hump: Math.max(0, Math.log((1.5 * d) / Math.max(fromR, toR))),
      onDone: opts.onDone,
    };
    this.stopInertia();
    this.zoomAnchor = null;
  }

  /** Arrive looking at the lit side (about 50 degrees phase), slightly above the orbit plane. */
  private approachDirection(target: FocusTarget, from: Vec3): Vec3 {
    if (target.approach) return normalize(target.approach());
    const pos = target.pos();
    const toSun = length(pos) > 1 ? normalize(scale(pos, -1)) : null;
    if (!toSun) {
      const away = sub(from, pos);
      return length(away) > 0 ? normalize(away) : this.dir;
    }
    // Rotate the sunward direction around ecliptic north toward the side we come from.
    const approach = normalize(sub(from, pos));
    const side = Math.sign(dot(cross(toSun, approach), ECLIPTIC_NORTH)) || 1;
    let d = rotateAxisAngle(toSun, ECLIPTIC_NORTH, side * 50 * DEG);
    const right = normalize(cross(ECLIPTIC_NORTH, d));
    d = rotateAxisAngle(d, right, -15 * DEG);
    return normalize(d);
  }

  cancelFlight(): void {
    if (!this.flight) return;
    // Freeze where we are: adopt the destination chain if past halfway.
    const f = this.flight;
    const s = f.t / f.duration;
    this.chain = s > 0.5 ? CameraController.chainFor(f.toId, this.resolve) : f.fromChain;
    const R = this.resolve(this.chain[0])?.radius ?? 0;
    const pivot = this.pivotFor(this.chain, Math.max(this.pose.r, R + 1));
    const off = sub(this.pose.position, pivot);
    this.dir = normalize(off);
    this.logH = this.logHTarget = Math.log(Math.max(length(off) - R, Math.exp(this.minLogH)));
    this.flight = null;
  }

  // ---- per-frame update ----------------------------------------------------

  update(dt: number): CameraPose {
    if (this.flight) return this.updateFlight(dt);

    // Zoom damping (critically damped, tau = 0.15 s).
    const a = 1 - Math.exp(-dt / 0.15);
    const prevLogH = this.logH;
    this.logH += (this.logHTarget - this.logH) * a;
    if (this.zoomAnchor && this.logH < prevLogH) {
      const frac = 1 - Math.exp(this.logH - prevLogH);
      const ang = angleBetween(this.dir, this.zoomAnchor);
      if (ang > 1e-6) this.dir = normalize(slerp(this.dir, this.zoomAnchor, clamp((frac * 0.9 * ang) / ang, 0, 1)));
    }

    // Orbit inertia.
    if (Math.abs(this.azVel) + Math.abs(this.elVel) > 1e-5) {
      this.applyOrbit(this.azVel * dt, this.elVel * dt);
      const decay = Math.exp(-dt / 0.25);
      this.azVel *= decay;
      this.elVel *= decay;
    }

    this.tiltTarget = Math.min(this.tiltTarget, this.maxTilt());
    this.tilt += (this.tiltTarget - this.tilt) * a;

    const r = this.distanceFor(this.chain, this.logH);
    return this.composePose(this.pivotFor(this.chain, r), r, this.dir, this.upFor(this.chain, r), this.tilt);
  }

  private updateFlight(dt: number): CameraPose {
    const f = this.flight!;
    f.t += dt;
    const s = smootherstep(f.t / f.duration);
    const target = this.resolve(f.toId)!;
    const p0 = this.pivotFor(f.fromChain, f.fromR);
    const p1 = target.pos();
    const sigma = smoothstep(0.15, 0.85, s);
    const pivot = lerp(p0, p1, sigma);
    const lnR = Math.log(f.fromR) + (Math.log(f.toR) - Math.log(f.fromR)) * s + f.hump * Math.sin(Math.PI * s);
    const r = Math.exp(lnR);
    const dir = normalize(slerp(f.dir0, f.dir1, smoothstep(0, 1, s)));
    const toChain = CameraController.chainFor(f.toId, this.resolve);
    const up = normalize(slerp(this.upFor(f.fromChain, r), this.upFor(toChain, r), sigma));
    const tilt = f.tilt0 * (1 - s);
    const pose = this.composePose(pivot, r, dir, up, tilt);
    if (f.t >= f.duration) {
      this.chain = toChain;
      this.dir = f.dir1;
      this.logH = this.logHTarget = Math.log(Math.max(f.toR - target.radius, target.minAltitude));
      this.tilt = this.tiltTarget = 0;
      this.flight = null;
      f.onDone?.();
    }
    return pose;
  }

  private composePose(pivot: Vec3, r: number, dir: Vec3, upHint: Vec3, tilt: number): CameraPose {
    const position = add(pivot, scale(dir, r));
    let forward = scale(dir, -1);
    let right = cross(forward, upHint);
    if (length(right) < 1e-9) right = cross(forward, Math.abs(forward[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    right = normalize(right);
    let up = normalize(cross(right, forward));
    if (tilt > 0) {
      forward = normalize(rotateAxisAngle(forward, right, tilt));
      up = normalize(cross(right, forward));
    }
    this.pose = { position, pivot, forward, up, right, r };
    return this.pose;
  }

  /** Jump without animation (used for deep links). */
  set(chain: string[], altitude: number, dir: Vec3): void {
    this.flight = null;
    this.chain = chain;
    this.logH = this.logHTarget = clamp(Math.log(Math.max(altitude, 1)), this.minLogH, this.maxLogH);
    this.dir = normalize(dir);
    this.stopInertia();
  }
}
