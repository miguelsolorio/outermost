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
  rotateBy,
  rotationBetween,
  scale,
  slerp,
  smoothstep,
  sub,
  type Vec3,
} from '../../astro/vec.ts';
import { DEG, OBLIQUITY_J2000 } from '../../astro/units.ts';
import { EQJ_TO_GAL, galaxyFrame } from '../../astro/galactic.ts';
import { flightDuration, glide, settleCurve, zoomPath, type ZoomPath } from './path.ts';

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

/** Longest step (s) a flight or settle advances per frame: a hitch slows the trip instead of skipping it ahead. */
const MAX_STEP = 0.05;
/** Share of a flight's motion carried into a new destination picked mid-flight (0 = start from rest). */
const CARRY = 1;
/** How long (s) the carried motion takes to bend onto the new path. */
const RETARGET_SETTLE = 0.5;

/**
 * What a pose is built from. The view looks at pivot + shift: the pivot stays
 * an exact body position (float64 rounds ~16 km at 2 kpc) and the shift
 * carries the rest, so points near the pivot stay exact (see `relPrecise`).
 */
interface ViewInputs {
  pivot: Vec3;
  shift: Vec3;
  r: number;
  dir: Vec3;
  up: Vec3;
  tilt: number;
}

/** The view as drawn (shift includes any settle), and the point it looks at. */
export interface View extends ViewInputs {
  lookAt: Vec3;
}

/** Per-channel offsets or rates: the pivot in units of r, dir and up as rotation vectors. */
interface Motion {
  pivot: Vec3;
  lnR: number;
  dir: Vec3;
  up: Vec3;
  tilt: number;
}

const STILL: Motion = { pivot: [0, 0, 0], lnR: 0, dir: [0, 0, 0], up: [0, 0, 0], tilt: 0 };

/**
 * An offset `x` (moving at `v` per second) from the view's source to what was
 * on screen when the source jumped, eased away over T seconds. This is what
 * keeps a new destination or an interrupted flight from snapping the view.
 */
interface Settle {
  t: number;
  T: number;
  x: Motion;
  v: Motion;
}

interface Flight {
  t: number;
  T: number;
  path: ZoomPath;
  /** Start and end pivots, re-read every frame so moving bodies are tracked. */
  from: () => Vec3;
  to: () => Vec3;
  upFrom: (r: number) => Vec3;
  upTo: (r: number) => Vec3;
  /** Up at the start, and on the last frame. */
  up0: Vec3;
  up: Vec3;
  /** Distance at which to take the zoomed-out up (see `flightSource`). */
  rMid: number;
  fromChain: string[];
  toChain: string[];
  toId: string;
  facing?: string;
  fromR: number;
  toR: number;
  landLogH: number;
  dir1: Vec3;
  /** The swing from dir0 to dir1 as azimuth and elevation about the up vector (see `swingDir`). */
  swing: { up0: Vec3; up1: Vec3; ref: Vec3; az0: number; dAz: number; el0: number; el1: number };
  tilt0: number;
  /** Share of the trip spent speeding up: none when taking over a flight already moving. */
  rampIn: number;
  /** How far up its climb from the start the flight got (0..1), for `transit.high`. */
  climbed: number;
  /** Flown to a set distance or direction, rather than the default framing. */
  custom: boolean;
  /** Last frame's eased progress, and fraction of the pan done and still to go. */
  e: number;
  pan: number;
  rest: number;
  landed: boolean;
  onDone?: () => void;
}

export interface CameraPose {
  position: Vec3;
  pivot: Vec3;
  /**
   * position − pivot, kept exactly. Far from the Sun `position` is rounded to
   * the float64 grid (≈16 km at 2 kpc), so precise camera-relative positions
   * near the pivot are (p − pivot) − offset (see `relPrecise`).
   */
  offset: Vec3;
  /** Unit vectors in world (EQJ) space. */
  forward: Vec3;
  up: Vec3;
  right: Vec3;
  /** Distance from pivot (m). */
  r: number;
}

export class CameraController {
  chain: string[] = ['earth', 'sun'];
  /** ln(altitude in m) above the focus surface. */
  logH = Math.log(2e7);
  logHTarget = this.logH;
  dir: Vec3 = normalize([0.3, -0.9, 0.3]);
  /** View tilt away from nadir (rad), Google Earth style. */
  tilt = 0;
  tiltTarget = 0;

  /** Where the view looks, relative to the pivot (m): set by panning, so the view isn't locked onto a body. */
  offset: Vec3 = [0, 0, 0];
  /** Map-like controls: the wheel zooms toward the cursor and the view never re-centers on a body. */
  freeMode = false;

  private azVel = 0;
  private elVel = 0;
  /** Pan inertia, in units of r per second. */
  private panVel: Vec3 = [0, 0, 0];
  private zoomAnchor: Vec3 | null = null;
  /** World ray under the cursor for a free-mode zoom, kept while the zoom eases in. */
  private zoomCursor: Vec3 | null = null;
  /** Distance still to fly (m) along `flyRay`, eased in like a zoom. */
  private flyLeft = 0;
  private flyRay: Vec3 = [0, 0, 0];
  /** A fly-through took the camera into a body: let it pass instead of pushing it out. */
  private tunneling = false;
  /** The look distance is easing to a fly-through's pace: hold the camera still while it does. */
  private flyZoom = false;
  /** Bodies a panned view can settle onto; they also set the pace of a fly-through. */
  anchors: string[] = [];
  private flight: Flight | null = null;
  private settle: Settle | null = null;
  private lastView: View | null = null;
  private vel: Motion = STILL;
  pose: CameraPose = {
    position: [0, 0, 0],
    pivot: [0, 0, 0],
    offset: [0, 0, 0],
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

  /** The view has been panned off its pivot. */
  get panned(): boolean {
    const o = this.offset;
    return o[0] !== 0 || o[1] !== 0 || o[2] !== 0;
  }

  /**
   * The trip under way: w is the fraction of the pan done; `high` once the
   * camera is well up its climb (or it started out that high).
   */
  get transit(): { fromChain: string[]; toChain: string[]; w: number; high: boolean } | null {
    const f = this.flight;
    return f ? { fromChain: f.fromChain, toChain: f.toChain, w: f.pan, high: f.climbed >= 0.6 } : null;
  }

  /** The chain the view belongs to: mid-flight it switches at the zoomed-out peak. */
  get viewChain(): string[] {
    const f = this.flight;
    return f ? (f.pan < 0.5 ? f.fromChain : f.toChain) : this.chain;
  }

  get viewFocusId(): string {
    return this.viewChain[0];
  }

  /** The last view drawn. */
  get view(): View | null {
    return this.lastView;
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

  /**
   * Wheel/pinch zoom. `amount` > 0 zooms out. `anchorDir` is the surface
   * direction under the cursor; in free mode `cursorRay` (the world ray under
   * the cursor) is held still on screen instead.
   */
  zoom(amount: number, anchorDir: Vec3 | null = null, cursorRay: Vec3 | null = null): void {
    if (this.flight) this.cancelFlight();
    this.logHTarget = clamp(this.logHTarget + amount, this.minLogH, this.maxLogH);
    this.flyZoom = false;
    this.zoomAnchor = amount < 0 && !this.freeMode ? anchorDir : null;
    this.zoomCursor = this.freeMode ? cursorRay : null;
  }

  /** Pan by a screen drag, in pixels: what's at the look distance follows the cursor. */
  pan(dx: number, dy: number, viewportH: number, fovRad: number): void {
    if (this.flight) this.cancelFlight();
    this.azVel = this.elVel = 0;
    this.zoomCursor = null;
    const r = this.pose.r;
    const m = (2 * r * Math.tan(fovRad / 2)) / viewportH;
    const d = add(scale(this.pose.right, -dx * m), scale(this.pose.up, dy * m));
    this.offset = add(this.offset, d);
    // Remember velocity for inertia (per second, assuming ~60 Hz input).
    this.panVel = scale(d, 60 / r);
  }

  /**
   * Fly along a world ray (the one under the cursor), through whatever is in
   * the way. `amount` > 0 backs away. The pace follows the nearest body: about
   * two of its radii per unit up close, so a planet is crossed in a pinch or
   * two, and faster out in the open, like the log zoom.
   */
  fly(amount: number, ray: Vec3): void {
    if (this.flight) this.cancelFlight();
    this.zoomAnchor = this.zoomCursor = null;
    const cam = this.pose.position;
    let pace = Infinity;
    for (const id of this.anchors) {
      const t = this.resolve(id);
      if (t && t.radius > 0) pace = Math.min(pace, Math.max(length(sub(t.pos(), cam)), 2 * t.radius));
    }
    if (!Number.isFinite(pace)) pace = this.pose.r;
    this.flyRay = ray;
    this.flyLeft -= amount * pace;
    this.tunneling = this.flyZoom = true;
    // Look about one pace ahead, so panning and zooming afterward work at the scale flown to.
    this.logHTarget = clamp(Math.log(Math.max(pace - this.focus.radius, 1)), this.minLogH, this.maxLogH);
  }

  /**
   * Once panned, hand the view to the body that looms largest from the look
   * point (least distance per radius, roughly whose gravity it's in), so it
   * moves with that body instead of drifting past. The view itself doesn't move.
   */
  reanchor(candidates: string[] = this.anchors): void {
    if (this.flight || !this.panned) return;
    const r = this.distanceFor(this.chain, this.logH);
    const look = add(this.pivotFor(this.chain, r), this.offset);
    // A focus that isn't one of the bodies (a spacecraft, a star) keeps the view while it's near.
    const cur = this.resolve(this.chain[0]);
    if (cur && !candidates.includes(cur.id) && length(sub(look, cur.pos())) < (cur.handoff?.[0] ?? 10 * r)) return;
    let best: { id: string; score: number } | null = null;
    for (const id of candidates) {
      const t = this.resolve(id);
      if (!t || t.radius <= 0 || r <= t.radius + t.minAltitude) continue;
      const dist = length(sub(look, t.pos()));
      if (dist >= (t.handoff?.[0] ?? 0)) continue;
      const score = dist / t.radius;
      if (!best || score < best.score) best = { id, score };
    }
    if (!best || best.id === this.chain[0]) return;
    const rTarget = this.distanceFor(this.chain, this.logHTarget);
    this.chain = CameraController.chainFor(best.id, this.resolve);
    const R = this.focus.radius;
    this.logH = Math.log(r - R);
    this.logHTarget = clamp(Math.log(Math.max(rTarget - R, 1)), this.minLogH, this.maxLogH);
    this.offset = sub(look, this.pivotFor(this.chain, r));
    this.zoomAnchor = null;
    // "Up" follows the new body's pole up close: ease the turn.
    this.beginSettle(0);
  }

  /** Orbit by a screen drag, in pixels, given the viewport height in pixels. */
  orbit(dx: number, dy: number, viewportH: number, fovRad: number): void {
    if (this.flight) this.cancelFlight();
    const r = this.pose.r;
    const h = this.altitude;
    const k = ((2 * fovRad) / viewportH) * clamp(h / r, 0.02, 1);
    this.zoomCursor = null;
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
    this.panVel = [0, 0, 0];
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

  /**
   * Fly to a target. `from`: arrive on the side of the target that faces this
   * object (e.g. down the Moon's shadow onto Earth). Picking a new destination
   * mid-flight starts from the view on screen and bends onto the new path.
   * `distance` and `arrive` (the direction from the target to arrive from)
   * override the default framing.
   */
  flyTo(id: string, fovRad: number, opts: { distance?: number; onDone?: () => void; from?: string; arrive?: Vec3 } = {}): void {
    const target = this.resolve(id);
    if (!target) return;
    const old = this.flight;
    const custom = opts.distance !== undefined || opts.arrive !== undefined;
    if (old && !old.custom && !custom && old.toId === id && old.facing === opts.from && !opts.onDone) return;
    const view = this.lastView ?? this.viewOf(this.freeSource(0));

    // Land exactly where the free camera will take over, so the last frame of
    // the flight and the first frame after it match.
    const toChain = CameraController.chainFor(id, this.resolve);
    const want = opts.distance ?? this.framingDistance(target, fovRad);
    const landLogH = clamp(Math.log(Math.max(want - target.radius, target.minAltitude)), Math.log(Math.max(1, target.minAltitude)), this.maxLogH);
    const toR = this.distanceFor(toChain, landLogH);
    const to = this.holdPivot(toChain, toR);

    let from: () => Vec3;
    let upFrom: (r: number) => Vec3;
    let fromChain: string[];
    if (old) {
      // Start from where the old flight is: the same fraction of the way between its (still moving) ends.
      const { from: a, to: b, up, pan, rest } = old;
      from = () => (pan <= 0.5 ? lerp(a(), b(), pan) : add(b(), scale(sub(a(), b()), rest)));
      upFrom = () => up;
      fromChain = pan < 0.5 ? old.fromChain : old.toChain;
      this.chain = fromChain;
    } else {
      fromChain = [...this.chain];
      // Set off from where a pan left the view; flights land centered.
      const hold = this.holdPivot(fromChain, view.r);
      const off = this.offset;
      from = this.panned ? () => add(hold(), off) : hold;
      upFrom = this.holdUp(fromChain);
    }
    this.offset = [0, 0, 0];
    this.zoomCursor = null;
    this.flyLeft = 0;
    this.flyZoom = false;

    const upTo = this.holdUp(toChain);
    const dir1 = opts.arrive ?? this.approachDirection(target, view.lookAt, opts.from ? this.resolve(opts.from) : undefined);
    const path = zoomPath(view.r, toR, length(sub(to(), from())), fovRad);
    const up0 = upFrom(view.r);
    this.flight = {
      t: 0,
      T: flightDuration(path.S, angleBetween(view.dir, dir1)),
      path,
      // Taking over a moving flight needs only a short ramp.
      rampIn: old ? 0.1 : 0.25,
      climbed: 0,
      custom,
      from,
      to,
      upFrom,
      upTo,
      up0,
      up: up0,
      // Up turns with scale only near the trip's own scales: a trip that merely
      // passes through the Galaxy doesn't roll to galactic north and back.
      rMid: Math.min(Math.exp(path.peakLnR), 100 * Math.max(view.r, toR)),
      fromChain,
      toChain,
      toId: id,
      facing: opts.from,
      fromR: view.r,
      toR,
      landLogH,
      dir1,
      swing: CameraController.swingFor(view.dir, dir1, up0, upTo(toR)),
      tilt0: view.tilt,
      e: 0,
      pan: 0,
      rest: 1,
      landed: false,
      onDone: opts.onDone,
    };
    this.stopInertia();
    this.zoomAnchor = null;
    this.beginSettle(old ? CARRY : 0);
  }

  /**
   * Azimuth and elevation of dir0 about up0 and of dir1 about up1, measured
   * from a reference direction carried along as up turns.
   */
  private static swingFor(dir0: Vec3, dir1: Vec3, up0: Vec3, up1: Vec3): Flight['swing'] {
    const level = (v: Vec3, up: Vec3): Vec3 => sub(v, scale(up, dot(v, up)));
    const h = level(dir0, up0);
    const ref = length(h) > 1e-6 ? normalize(h) : normalize(cross(up0, Math.abs(up0[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const ref1 = normalize(level(rotateBy(ref, rotationBetween(up0, up1)), up1));
    const az = (d: Vec3, up: Vec3, e1: Vec3): number => Math.atan2(dot(d, cross(up, e1)), dot(d, e1));
    const el = (d: Vec3, up: Vec3): number => Math.asin(clamp(dot(d, up), -1, 1));
    const az0 = az(dir0, up0, ref);
    let dAz = az(dir1, up1, ref1) - az0;
    dAz -= 2 * Math.PI * Math.round(dAz / (2 * Math.PI));
    return { up0, up1, ref, az0, dAz, el0: el(dir0, up0), el1: el(dir1, up1) };
  }

  /**
   * The arrival swing at progress e, as an orbit about an axis turning evenly
   * from the start's up to the end's: azimuth and elevation move evenly, so the
   * view never tips over the pole (where a straight slerp can pass and the roll
   * spins). The axis ignores how `upFor` changes with scale, so zooming past a
   * galaxy doesn't swing the view with it.
   */
  private swingDir(f: Flight, e: number): Vec3 {
    const w = f.swing;
    const up = normalize(slerp(w.up0, w.up1, e));
    const r = rotateBy(w.ref, rotationBetween(w.up0, up));
    const e1 = normalize(sub(r, scale(up, dot(r, up))));
    const e2 = cross(up, e1);
    const az = w.az0 + w.dAz * e;
    const el = w.el0 + (w.el1 - w.el0) * e;
    const c = Math.cos(el);
    return normalize(add(add(scale(e1, c * Math.cos(az)), scale(e2, c * Math.sin(az))), scale(up, Math.sin(el))));
  }

  /** A chain's pivot at distance r, held at its last value if the chain's focus stops resolving (time scrubbed past it). */
  private holdPivot(chain: string[], r: number): () => Vec3 {
    let last: Vec3 = this.resolve(chain[0]) ? this.pivotFor(chain, r) : this.pose.pivot;
    return () => (this.resolve(chain[0]) ? (last = this.pivotFor(chain, r)) : last);
  }

  private holdUp(chain: string[]): (r: number) => Vec3 {
    let last: Vec3 = this.pose.up;
    return (r) => (this.resolve(chain[0]) ? (last = this.upFor(chain, r)) : last);
  }

  /**
   * Arrive looking at the lit side (about 50 degrees phase), slightly above the
   * orbit plane, or, given `facing`, from the direction of that object.
   */
  private approachDirection(target: FocusTarget, from: Vec3, facing?: FocusTarget): Vec3 {
    if (facing) {
      const toward = sub(facing.pos(), target.pos());
      if (length(toward) > 0) return normalize(toward);
    }
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

  /** Stop a flight (the user grabbed the view): keep looking the same way and ease the pivot back to the focus. */
  cancelFlight(): void {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    const ok = (c: string[]): boolean => !!this.resolve(c[0]);
    const [near, far] = f.pan < 0.5 ? [f.fromChain, f.toChain] : [f.toChain, f.fromChain];
    this.chain = ok(near) ? near : ok(far) ? far : CameraController.chainFor('sun', this.resolve);
    const view = this.lastView;
    if (!view) return;
    this.logH = this.logHTarget = clamp(Math.log(Math.max(view.r - this.focus.radius, 1)), this.minLogH, this.maxLogH);
    this.dir = view.dir;
    this.tilt = view.tilt;
    this.tiltTarget = Math.min(view.tilt, this.maxTilt());
    this.beginSettle(0);
  }

  /**
   * The view's source is about to jump (new destination, interrupted flight):
   * record how far the view on screen is from the new source, and ease that
   * away. `carry` keeps that share of the view's current motion.
   */
  private beginSettle(carry: number): void {
    const view = this.lastView;
    this.settle = null;
    if (!view) return;
    const src = this.flight ? this.flightSource(0) : this.freeSource(0);
    const x: Motion = {
      pivot: scale(this.between(src, view), 1 / src.r),
      lnR: Math.log(view.r / src.r),
      dir: rotationBetween(src.dir, view.dir),
      up: rotationBetween(src.up, view.up),
      tilt: view.tilt - src.tilt,
    };
    // Carry the difference between how the view was moving and how the new source starts out.
    const sv = this.flight ? this.flightStartVelocity() : STILL;
    const v: Motion =
      carry > 0
        ? {
            pivot: scale(sub(this.vel.pivot, sv.pivot), carry),
            lnR: (this.vel.lnR - sv.lnR) * carry,
            dir: scale(sub(this.vel.dir, sv.dir), carry),
            up: scale(sub(this.vel.up, sv.up), carry),
            tilt: (this.vel.tilt - sv.tilt) * carry,
          }
        : STILL;
    const size = (m: Motion): number => length(m.pivot) + Math.abs(m.lnR) + length(m.dir) + length(m.up) + Math.abs(m.tilt);
    if (size(x) + size(v) < 1e-9) return;
    // A bigger jump takes a little longer, so it never races across the screen.
    const T = carry > 0 ? RETARGET_SETTLE : clamp(0.5 + 0.35 * length(x.pivot), 0.5, 1);
    this.settle = { t: 0, T, x, v };
  }

  /** How the flight just set up starts out moving (per second; pivot in units of r). */
  private flightStartVelocity(): Motion {
    const f = this.flight!;
    const h = 1e-3;
    const a = this.flightSource(0);
    f.t = h;
    const b = this.flightSource(0);
    f.t = 0;
    f.climbed = 0;
    this.flightSource(0);
    return {
      pivot: scale(this.between(a, b), 1 / (h * a.r)),
      lnR: Math.log(b.r / a.r) / h,
      dir: scale(rotationBetween(a.dir, b.dir), 1 / h),
      up: scale(rotationBetween(a.up, b.up), 1 / h),
      tilt: (b.tilt - a.tilt) / h,
    };
  }

  // ---- per-frame update ----------------------------------------------------

  update(dt: number): CameraPose {
    const step = Math.min(dt, MAX_STEP);
    const f = this.flight;
    const pose = this.emit(f ? this.flightSource(step) : this.freeSource(dt), step);
    if (f?.landed) f.onDone?.();
    return pose;
  }

  /** The free camera: zoom damping, orbit inertia and tilt. With dt = 0 it only reads. */
  private freeSource(dt: number): ViewInputs {
    if (dt > 0) {
      // Zoom damping (critically damped, tau = 0.15 s).
      const a = 1 - Math.exp(-dt / 0.15);
      const prevLogH = this.logH;
      this.logH += (this.logHTarget - this.logH) * a;
      if (this.zoomAnchor && this.logH < prevLogH) {
        const frac = 1 - Math.exp(this.logH - prevLogH);
        const ang = angleBetween(this.dir, this.zoomAnchor);
        if (ang > 1e-6) this.dir = normalize(slerp(this.dir, this.zoomAnchor, clamp((frac * 0.9 * ang) / ang, 0, 1)));
      }
      const r0 = this.distanceFor(this.chain, prevLogH);
      const r1 = this.distanceFor(this.chain, this.logH);
      if (r1 !== r0) {
        // Flying, the look distance follows the pace with the camera held still.
        if (this.flyZoom) this.offset = sub(this.offset, scale(this.dir, r1 - r0));
        // Free-mode zoom: keep the point under the cursor, on the plane through the look point, still on screen.
        const d = this.zoomCursor;
        const c = d ? -dot(d, this.dir) : 0;
        if (d && c > 1e-3) this.offset = add(this.offset, scale(add(scale(this.dir, r0), scale(d, r0 / c)), 1 - r1 / r0));
        // Once panned, the look point stays put as the pivot hands off to the parent.
        if (this.panned) this.offset = sub(this.offset, sub(this.pivotFor(this.chain, r1), this.pivotFor(this.chain, r0)));
      }

      // Pan inertia.
      if (length(this.panVel) > 1e-4) {
        this.offset = add(this.offset, scale(this.panVel, r1 * dt));
        this.panVel = scale(this.panVel, Math.exp(-dt / 0.25));
      } else this.panVel = [0, 0, 0];

      // Fly-through: camera and look point move together along the ray.
      if (this.flyLeft !== 0) {
        const step = this.flyLeft * a;
        this.offset = add(this.offset, scale(this.flyRay, step));
        this.flyLeft -= step;
        if (Math.abs(this.flyLeft) < 1e-4 * r1) this.flyLeft = 0;
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
    }

    const r = this.distanceFor(this.chain, this.logH);
    const pivot = this.pivotFor(this.chain, r);
    if (dt > 0 && this.panned) this.keepOutside(pivot, r);
    return { pivot, shift: this.offset, r, dir: this.dir, up: this.upFor(this.chain, r), tilt: this.tilt };
  }

  /** Panned, the camera isn't over the focus any more: don't let it pass into the body. */
  private keepOutside(pivot: Vec3, r: number): void {
    const f = this.resolve(this.focusId);
    if (!f || f.radius <= 0) return;
    const v = sub(add(this.offset, scale(this.dir, r)), sub(f.pos(), pivot));
    const d = length(v);
    const min = f.radius + f.minAltitude;
    if (this.tunneling) {
      if (d >= min && this.flyLeft === 0) this.tunneling = false;
      return;
    }
    if (d >= min) return;
    this.offset = add(this.offset, scale(d > 1e-9 ? scale(v, 1 / d) : this.dir, min - d));
  }

  private flightSource(step: number): ViewInputs {
    const f = this.flight!;
    if (!this.resolve(f.toId)) {
      // The destination has no data at this time any more.
      this.cancelFlight();
      return this.freeSource(0);
    }
    f.t += step;
    if (f.t >= f.T) {
      this.chain = f.toChain;
      this.dir = f.dir1;
      this.logH = this.logHTarget = f.landLogH;
      this.tilt = this.tiltTarget = 0;
      this.flight = null;
      f.landed = true;
      return { pivot: f.to(), shift: [0, 0, 0], r: f.toR, dir: f.dir1, up: f.upTo(f.toR), tilt: 0 };
    }
    // One eased progress drives everything: the pan and zoom along the path,
    // the swing to the arrival side, the up vector and the tilt.
    const e = glide(f.t / f.T, f.rampIn);
    const { f: pan, g: rest, lnR } = f.path.at(e * f.path.L);
    const r = Math.exp(lnR);
    // Climb from the start toward the path's top; a trip that starts at its top is high from the outset.
    const lnStart = Math.log(f.fromR);
    const rise = f.path.peakLnR - lnStart;
    f.climbed = Math.max(f.climbed, rise > 0.1 ? clamp((lnR - lnStart) / rise, 0, 1) : 1);
    // Up turns evenly from the start's to the end's, leaning toward the
    // zoomed-out up (ecliptic north between planets) as the camera climbs.
    // Following upFor's scale bands directly would roll the view fast as the
    // zoom races through them.
    const ends = normalize(slerp(f.up0, f.upTo(f.toR), e));
    const mid = normalize(slerp(f.upFrom(f.rMid), f.upTo(f.rMid), e));
    const lnHi = Math.log(Math.max(f.fromR, f.toR));
    const lnMid = Math.log(f.rMid);
    const climb = lnMid > lnHi ? smoothstep(lnHi, lnMid, lnR) : 0;
    const up = normalize(slerp(ends, mid, climb));
    f.up = up;
    const a = f.from();
    const b = f.to();
    f.e = e;
    f.pan = pan;
    f.rest = rest;
    return {
      // Anchored on the nearer end, so a 1e19 m trip still lands on the meter.
      pivot: pan <= 0.5 ? a : b,
      shift: pan <= 0.5 ? scale(sub(b, a), pan) : scale(sub(a, b), rest),
      r,
      dir: this.swingDir(f, e),
      up,
      tilt: f.tilt0 * (1 - e),
    };
  }

  private viewOf(src: ViewInputs): View {
    return { ...src, lookAt: add(src.pivot, src.shift) };
  }

  /** Apply any settle, track the view's motion, and build the pose. */
  private emit(src: ViewInputs, step: number): CameraPose {
    let { shift, r, dir, up, tilt } = src;
    const st = this.settle;
    if (st) {
      st.t += step;
      if (st.t >= st.T) this.settle = null;
      else {
        const u = st.t / st.T;
        const c = (x: number, v: number): number => settleCurve(x, v, u, st.T);
        const cv = (x: Vec3, v: Vec3): Vec3 => [c(x[0], v[0]), c(x[1], v[1]), c(x[2], v[2])];
        shift = add(src.shift, scale(cv(st.x.pivot, st.v.pivot), src.r));
        r = Math.exp(Math.log(src.r) + c(st.x.lnR, st.v.lnR));
        dir = normalize(rotateBy(src.dir, cv(st.x.dir, st.v.dir)));
        up = normalize(rotateBy(src.up, cv(st.x.up, st.v.up)));
        tilt = Math.max(0, src.tilt + c(st.x.tilt, st.v.tilt));
      }
    }
    const view: View = { pivot: src.pivot, shift, r, dir, up, tilt, lookAt: add(src.pivot, shift) };
    const prev = this.lastView;
    if (prev && step > 1e-6) {
      this.vel = {
        pivot: scale(this.between(prev, view), 1 / (step * r)),
        lnR: Math.log(r / prev.r) / step,
        dir: scale(rotationBetween(prev.dir, dir), 1 / step),
        up: scale(rotationBetween(prev.up, up), 1 / step),
        tilt: (tilt - prev.tilt) / step,
      };
    }
    this.lastView = view;
    return this.composePose(src.pivot, r, dir, up, tilt, shift);
  }

  /** b's look point minus a's, exact when they share a pivot. */
  private between(a: ViewInputs, b: ViewInputs): Vec3 {
    return add(sub(b.pivot, a.pivot), sub(b.shift, a.shift));
  }

  /** The camera looks at pivot + shift. */
  private composePose(pivot: Vec3, r: number, dir: Vec3, upHint: Vec3, tilt: number, shift: Vec3): CameraPose {
    const offset = add(scale(dir, r), shift);
    const position = add(pivot, offset);
    let forward = scale(dir, -1);
    let right = cross(forward, upHint);
    if (length(right) < 1e-9) right = cross(forward, Math.abs(forward[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    right = normalize(right);
    let up = normalize(cross(right, forward));
    if (tilt > 0) {
      forward = normalize(rotateAxisAngle(forward, right, tilt));
      up = normalize(cross(right, forward));
    }
    this.pose = { position, pivot, offset, forward, up, right, r };
    return this.pose;
  }

  /** Jump without animation (used for deep links). */
  set(chain: string[], altitude: number, dir: Vec3): void {
    this.flight = null;
    this.settle = null;
    this.lastView = null;
    this.vel = STILL;
    this.chain = chain;
    this.offset = [0, 0, 0];
    this.zoomCursor = null;
    this.flyLeft = 0;
    this.flyZoom = false;
    this.tunneling = false;
    this.logH = this.logHTarget = clamp(Math.log(Math.max(altitude, 1)), this.minLogH, this.maxLogH);
    this.dir = normalize(dir);
    this.stopInertia();
  }
}
