// Ship mode: a first-person ship flown from its cockpit.
//
// The ship's position is kept as an exact offset from a reference target (the
// body whose neighborhood it's in), never as a heliocentric position. So it
// rides along with Earth or the ISS, a jump in time carries it with its body,
// and points near a far-off reference (a black hole kiloparsecs out) stay
// exact. When the ship crosses into another body's neighborhood the offset is
// re-based exactly, and the view eases from moving with the old body to
// moving with the new one.
//
// Speeds are in *pace* units: the distance to the nearest surface. A second of
// thrust covers the same share of the way whether you're skimming the Moon or
// crossing between galaxies, and heading at a surface you slow down on your
// own, the way the log zoom does.

import {
  add,
  angleBetween,
  clamp,
  cross,
  dot,
  length,
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
import { AU, DEG, OBLIQUITY_J2000 } from '../../astro/units.ts';
import { toGalactic } from '../../astro/galactic.ts';
import { framingDistance, MAX_DISTANCE, viewUp, type CameraPose, type FocusTarget, type Resolver, type ViewRig } from './controller.ts';

/**
 * How the ship treats a target: `solid` things (bodies, stars, black holes)
 * have surfaces to stay outside of; `point`s (spacecraft, asteroids) only
 * matter as destinations; `container`s (galaxies, groups) are regions it can
 * be inside of.
 */
export type ShipKind = 'solid' | 'point' | 'container';

export interface ShipHooks {
  resolve: Resolver;
  /** Ids the ship may take its frame from, pace itself by and collide with. */
  candidates(): readonly string[];
  kind(id: string): ShipKind;
  /** Simulated seconds per real second. */
  timeRate(): number;
  fovRad(): number;
}

/** Held controls, each −1..1. */
export interface ShipControls {
  /** Strafe right, rise, forward. */
  thrust: Vec3;
  /** Pitch (nose up), yaw (nose right), roll (right wing down). */
  turn: Vec3;
  boost: boolean;
  fine: boolean;
}

export interface ShipTelemetry {
  /** Speed relative to the frame (m/s). */
  speed: number;
  /** Forward drift as a share of full boost (−1..1). */
  throttle: number;
  boost: boolean;
  fine: boolean;
  /** Distance to the nearest surface (m): the scale speeds are measured in. */
  pace: number;
  frame: string;
  nearest: { id: string; altitude: number } | null;
  /** Where the nose points (degrees), ecliptic in the Solar System, galactic beyond. */
  heading: { lon: number; lat: number; system: 'ecliptic' | 'galactic' };
  autopilot: { id: string; phase: 'turning' | 'cruising' | 'arriving' | 'facing'; distance: number; eta: number } | null;
  holding: string | null;
}

/** Cruise drift, pace units per second; boost and fine scale it. */
const CRUISE = 1;
const BOOST = 4;
const FINE = 0.2;
/** Drift easing (s): spooling up, coasting to rest, an all-stop, and under autopilot (fast enough not to overshoot). */
const SPOOL = 0.35;
const COAST = 0.45;
const BRAKE = 0.15;
const AUTO_TAU = 0.06;
/** A scroll's travel eases in like a zoom. */
const GLIDE_TAU = 0.15;
const TURN_TAU = 0.15;
const KEY_TURN = 45 * DEG;
const ROLL_RATE = 90 * DEG;
/** After a flick of the view, the turn it had coasts to rest over about this long (s), like the orbit drag's. */
const FLING_TAU = 0.25;
/** Fastest turn a flick can leave (rad/s). */
const FLING_MAX = 4;
/** Fine control also slows turning, for lining up on something small. */
const FINE_TURN = 0.3;
const HEAD_YAW = 150 * DEG;
const HEAD_PITCH = 80 * DEG;
/** Head spring stiffness (1/s): back to straight ahead in about half a second. */
const HEAD_W = 9;
/** Longest physics substep (s). */
const MAX_H = 0.02;
/** How long (s) the view takes to go from moving with one body to moving with the next. */
const BLEND_T = 1.2;
/** A destination claims the frame within this many arrival distances, and lets go beyond RELEASE. */
const CLAIM = 3;
const RELEASE = 4;
/** A new neighbor must be this much more local (by distance per radius) to take the frame. */
const SWITCH = 0.8;
/** Containers every ship position falls in, innermost first. */
const OUTER = ['milky-way', 'local-group', 'observable-universe'];
/** Autopilot: turn at most this fast, with this gain on the remaining angle (critically damped with TURN_TAU). */
const AUTO_TURN = 90 * DEG;
const AUTO_GAIN = 1.6;

interface Body {
  id: string;
  t: FocusTarget;
  kind: ShipKind;
  pos: Vec3;
}

/** Easing the view from one frame to another: `from` is where it was measured against the old body. */
interface Blend {
  id: string;
  fromRel: Vec3;
  lastPos: Vec3;
  lnR0: number;
  chain0: string[];
  t: number;
  T: number;
  /** The last frame's gap between the two frames' views, to spot a jump in time. */
  gap: Vec3 | null;
}

interface Auto {
  id: string;
  from?: string;
  distance?: number;
  /** Only turn to face it. */
  faceOnly: boolean;
  phase: 'turning' | 'cruising' | 'arriving' | 'facing';
  L: number;
  Ad: number;
}

const smootherstep = (x: number): number => {
  const u = clamp(x, 0, 1);
  return u * u * u * (u * (u * 6 - 15) + 10);
};

/** One critically damped spring step toward 0, exact for any h. */
function spring(x: number, v: number, h: number): [number, number] {
  const e = Math.exp(-HEAD_W * h);
  const k = v + HEAD_W * x;
  return [(x + k * h) * e, (v - HEAD_W * k * h) * e];
}

const ZERO: Vec3 = [0, 0, 0];

export class ShipController implements ViewRig {
  /** The target whose frame the ship moves with. */
  ref = 'earth';
  /** Ship position minus the reference's (m), kept exact. */
  rel: Vec3 = [0, 0, 1e7];
  /** Heading and up, inertial (EQJ): the ship doesn't turn with a planet's spin. */
  fwd: Vec3 = [0, 1, 0];
  up: Vec3 = [0, 0, 1];
  /** Drift relative to the frame, in pace units per second. */
  u: Vec3 = [0, 0, 0];
  /** Turn rate, a world rotation vector (rad/s). */
  spin: Vec3 = [0, 0, 0];
  /** Scroll travel still to go, in pace units (+ is forward). */
  glide = 0;
  /** Looking around the cockpit: yaw (right +) and pitch (up +) from straight ahead. */
  head = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, held: false };
  controls: ShipControls = { thrust: [0, 0, 0], turn: [0, 0, 0], boost: false, fine: false };
  /** After arriving somewhere (or entering ship mode at it), stay in its frame while near. */
  hold: string | null = null;
  /** Distance to the nearest surface at the last step (m). */
  pace = 1;
  /** How fast the ship actually moved at the last step, relative to its frame (m/s): drift, scroll travel and sliding. */
  speed = 0;
  /** Which way it moved (unit), or null at rest. */
  drift: Vec3 | null = null;
  pose: CameraPose = { position: [0, 0, 0], pivot: [0, 0, 0], offset: [0, 0, 0], forward: [0, 1, 0], up: [0, 0, 1], right: [1, 0, 0], r: 1 };

  private auto: Auto | null = null;
  private blend: Blend | null = null;
  private braking = false;
  private leveling = false;
  /** The view is held by a drag: it turns only as the pointer moves. */
  private grabbing = false;
  /** Turn from the drag since the last frame, and its recent rate (rad/s), handed to `spin` on release. */
  private grabbed: Vec3 = [0, 0, 0];
  private grabRate: Vec3 = [0, 0, 0];
  /** Coasting from a flick: the turn eases out like the orbit drag's inertia. */
  private fling = false;
  private chain: string[] = ['earth', 'sun'];
  private lastRefPos: Vec3 = [0, 0, 0];
  private refParentOffset: Vec3 | null = null;

  constructor(private hooks: ShipHooks) {}

  // ---- ViewRig ---------------------------------------------------------------

  get focusId(): string {
    return this.ref;
  }

  get viewChain(): string[] {
    const b = this.blend;
    return b && this.blendW(b) < 0.5 ? b.chain0 : this.chain;
  }

  get viewFocusId(): string {
    return this.viewChain[0];
  }

  get transit(): ViewRig['transit'] {
    const b = this.blend;
    return b ? { fromChain: b.chain0, toChain: this.chain, w: this.blendW(b), high: true } : null;
  }

  /** Under autopilot to somewhere (turning in place doesn't count). */
  get flying(): boolean {
    return !!this.auto && !this.auto.faceOnly;
  }

  dominantId(): string {
    return this.ref;
  }

  /** The autopilot's destination, or what it's turning to face. */
  get targetId(): string | null {
    return this.auto?.id ?? null;
  }

  // ---- entering and leaving ------------------------------------------------------

  /**
   * Take over from the orbit camera at exactly its pose: in the frame of what
   * it was looking at, facing the way it faced. `vel` (m/s, relative to that
   * frame) and `spin` (rad/s) keep a moving view moving.
   */
  enter(pose: CameraPose, focusId: string, chain0: string[], seed: { vel?: Vec3; spin?: Vec3 } = {}): void {
    const t = this.hooks.resolve(focusId) ?? this.hooks.resolve('sun');
    if (!t) return;
    const refPos = t.pos();
    this.ref = t.id;
    this.chain = this.chainFor(t.id);
    this.rel = add(sub(pose.pivot, refPos), pose.offset);
    this.fwd = normalize(pose.forward);
    this.up = normalize(sub(pose.up, scale(this.fwd, dot(pose.up, this.fwd))));
    this.head = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0, held: false };
    this.controls = { thrust: [0, 0, 0], turn: [0, 0, 0], boost: false, fine: false };
    this.grabbing = this.fling = false;
    this.grabbed = [0, 0, 0];
    this.grabRate = [0, 0, 0];
    this.auto = null;
    this.glide = 0;
    this.braking = this.leveling = false;
    // A spacecraft or a galaxy isn't a place the ship would otherwise pick as its frame: stay with it while near.
    this.hold = this.hooks.kind(t.id) === 'solid' ? null : t.id;
    this.lastRefPos = refPos;
    this.refParentOffset = null;
    this.pace = this.paceOf(this.gather());
    const u = scale(seed.vel ?? ZERO, 1 / this.pace);
    this.u = length(u) > BOOST ? scale(normalize(u), BOOST) : u;
    this.spin = seed.spin ?? [0, 0, 0];
    // The orbit camera's r may be to a pivot partway to the parent: ease the scale signal over.
    this.blend = { id: t.id, fromRel: this.rel, lastPos: refPos, lnR0: Math.log(Math.max(pose.r, 1)), chain0: chain0, t: 0, T: 1, gap: null };
    this.compose();
  }

  /**
   * What the orbit camera needs to take over: the view on screen, the chain
   * to orbit, how far out to put its pivot (the body ahead if there is one),
   * whether that body is close enough to the middle to glide to center, and
   * the ship's motion.
   */
  exitView(): { chain: string[]; view: { pivot: Vec3; offset: Vec3; forward: Vec3; up: Vec3 }; r: number; center: boolean; vel: Vec3; spin: Vec3; destination: string | null } {
    const p = this.pose;
    const t = this.hooks.resolve(this.ref);
    const R = t?.radius ?? 0;
    const toC = scale(p.offset, -1);
    const F = p.forward;
    const ahead = dot(toC, F);
    const miss = length(sub(toC, scale(F, ahead)));
    const r = ahead > 0 ? Math.max(ahead, R + (t?.minAltitude ?? 0)) : length(toC);
    return {
      chain: this.chain,
      view: { pivot: p.pivot, offset: p.offset, forward: F, up: p.up },
      r: Math.max(r, 1),
      center: ahead > 0 && miss < Math.max(1.5 * R, 0.15 * ahead),
      vel: scale(this.u, this.pace),
      spin: this.spin,
      destination: this.flying ? this.auto!.id : null,
    };
  }

  // ---- input -------------------------------------------------------------------

  /** Held thrust, turn and modifiers; any manual command takes over from the autopilot. */
  setControls(c: ShipControls): void {
    this.controls = c;
    if (length(c.thrust) > 0) this.braking = false;
    if (length(c.thrust) > 0 || length(c.turn) > 0) this.cancelAuto();
    if (length(c.turn) > 0) this.fling = false;
    if (c.turn[2] !== 0) this.leveling = false;
  }

  /** Take hold of the view (a press): it stops turning and follows the pointer. */
  beginGrab(): void {
    this.grabbing = true;
    this.fling = false;
    this.spin = [0, 0, 0];
    this.grabbed = [0, 0, 0];
    this.grabRate = [0, 0, 0];
  }

  /**
   * Turn the ship by a drag, grabbing the sky: what's at the middle of the
   * view follows the pointer exactly, as the orbit camera's drag does.
   */
  grab(dx: number, dy: number, viewportH: number): void {
    if (!this.grabbing) this.beginGrab();
    this.cancelAuto();
    this.leveling = false;
    const k = (2 * Math.tan(this.hooks.fovRad() / 2)) / viewportH;
    // Turn about the view's own axes, so it tracks the pointer even while looking around.
    const p = this.pose;
    const rv = add(scale(p.up, Math.atan(dx * k)), scale(p.right, Math.atan(dy * k)));
    const f = normalize(rotateBy(this.fwd, rv));
    const u = rotateBy(this.up, rv);
    this.fwd = f;
    this.up = normalize(sub(u, scale(f, dot(u, f))));
    this.grabbed = add(this.grabbed, rv);
    this.compose();
  }

  /** Let go of the view: it keeps turning the way it was flicked, and coasts to rest. */
  releaseGrab(): void {
    if (!this.grabbing) return;
    this.grabbing = false;
    const w = length(this.grabRate);
    this.spin = w > FLING_MAX ? scale(this.grabRate, FLING_MAX / w) : this.grabRate;
    this.fling = w > 1e-4;
  }

  /** Fly along the heading by `amount` pace units (a scroll or pinch; + is forward). */
  nudge(amount: number): void {
    this.cancelAuto();
    this.braking = false;
    this.glide += amount;
  }

  /** All stop. */
  stop(): void {
    this.cancelAuto();
    this.glide = 0;
    this.braking = true;
  }

  /** Roll level with the local north (the body's pole up close, ecliptic north farther out). */
  level(): void {
    this.leveling = true;
  }

  /** Look around the cockpit by a screen drag: what's under the cursor follows it. */
  look(dx: number, dy: number, viewportH: number): void {
    const k = (2 * Math.tan(this.hooks.fovRad() / 2)) / viewportH;
    const h = this.head;
    h.held = true;
    h.vYaw = h.vPitch = 0;
    h.yaw = clamp(h.yaw - Math.atan(dx * k), -HEAD_YAW, HEAD_YAW);
    h.pitch = clamp(h.pitch + Math.atan(dy * k), -HEAD_PITCH, HEAD_PITCH);
  }

  /** Let go of the look: the head springs back to straight ahead. */
  releaseLook(): void {
    this.head.held = false;
  }

  /**
   * Autopilot to a target: turn toward it, then fly to its framing distance
   * (or `distance`), arriving from `from`'s side, its preferred approach, or
   * the way we're coming, and stay with it once there.
   */
  engage(id: string, opts: { from?: string; distance?: number } = {}): void {
    if (!this.hooks.resolve(id)) return;
    this.braking = this.leveling = false;
    this.glide = 0;
    this.auto = { id, from: opts.from, distance: opts.distance, faceOnly: false, phase: 'turning', L: Infinity, Ad: 0 };
  }

  /** Turn to face a target without moving. */
  face(id: string): void {
    if (!this.hooks.resolve(id)) return;
    this.leveling = false;
    this.auto = { id, faceOnly: true, phase: 'facing', L: 0, Ad: 0 };
  }

  cancelAuto(): void {
    this.auto = null;
  }

  // ---- per-frame update --------------------------------------------------------

  update(dt: number): CameraPose {
    if (dt > 0) {
      this.rehome();
      const env = this.gather();
      this.checkBlend(env);
      const n = Math.max(1, Math.ceil(dt / MAX_H));
      const h = dt / n;
      if (this.grabbing) {
        // How fast the drag has been turning the view lately, for the flick on release.
        this.grabRate = add(this.grabRate, scale(sub(scale(this.grabbed, 1 / dt), this.grabRate), 1 - Math.exp(-dt / 0.05)));
        this.grabbed = [0, 0, 0];
      }
      for (let i = 0; i < n; i++) this.step(h, env);
      this.stepHead(dt);
    }
    return this.compose();
  }

  /** Readouts for the HUD. */
  telemetry(): ShipTelemetry {
    const env = this.gather();
    let nearest: ShipTelemetry['nearest'] = null;
    for (const b of env.values()) {
      if (b.kind !== 'solid' || b.t.radius <= 0) continue;
      const alt = length(this.local(b, env)) - b.t.radius;
      if (!nearest || alt < nearest.altitude) nearest = { id: b.id, altitude: alt };
    }
    const sun = env.get('sun');
    const fromSun = sun ? length(this.local(sun, env)) : Infinity;
    const heading = fromSun > 1e4 * AU ? galactic(this.fwd) : ecliptic(this.fwd);
    const a = this.auto;
    return {
      speed: this.speed,
      throttle: clamp(dot(this.u, this.fwd) / BOOST, -1, 1),
      boost: this.controls.boost,
      fine: this.controls.fine,
      pace: this.pace,
      frame: this.ref,
      nearest,
      heading,
      autopilot: a ? { id: a.id, phase: a.phase, distance: a.L, eta: a.faceOnly ? 0 : Math.max(0, Math.log(Math.max(a.L, 1) / Math.max(0.01 * a.Ad, 1)) / 3) } : null,
      holding: this.hold,
    };
  }

  private chainFor(id: string): string[] {
    const out: string[] = [];
    let cur: string | null = id;
    while (cur && out.length < 16) {
      out.push(cur);
      cur = this.hooks.resolve(cur)?.parent ?? null;
    }
    return out;
  }

  /** Every target that matters this frame, positions read once. */
  private gather(): Map<string, Body> {
    const env = new Map<string, Body>();
    const ids = [this.ref, ...this.chain, ...OUTER, ...this.hooks.candidates()];
    if (this.auto) ids.push(this.auto.id);
    if (this.hold) ids.push(this.hold);
    if (this.blend) ids.push(this.blend.id);
    for (const id of ids) {
      if (env.has(id)) continue;
      const t = this.hooks.resolve(id);
      if (!t) continue;
      const pos = t.pos();
      if (!Number.isFinite(pos[0] + pos[1] + pos[2])) continue;
      env.set(id, { id, t, kind: this.hooks.kind(id), pos });
    }
    return env;
  }

  /** Ship minus `b`, computed near the reference so it stays exact near a far-off one. */
  private local(b: Body, env: Map<string, Body>): Vec3 {
    const refPos = env.get(this.ref)?.pos ?? this.lastRefPos;
    return add(sub(refPos, b.pos), this.rel);
  }

  /**
   * The reference has no position any more (the clock moved before a
   * spacecraft launched): move to its parent, placed against it as the ship
   * was against the craft.
   */
  private rehome(): void {
    const t = this.hooks.resolve(this.ref);
    if (t) {
      const p = t.pos();
      this.lastRefPos = p;
      const parent = t.parent ? this.hooks.resolve(t.parent) : undefined;
      this.refParentOffset = parent ? sub(p, parent.pos()) : null;
      return;
    }
    if (this.auto && !this.hooks.resolve(this.auto.id)) this.auto = null;
    if (this.hold && !this.hooks.resolve(this.hold)) this.hold = null;
    for (const [i, id] of this.chain.slice(1).concat('sun').entries()) {
      const p = this.hooks.resolve(id);
      if (!p) continue;
      this.rel = i === 0 && this.refParentOffset ? add(this.refParentOffset, this.rel) : add(sub(this.lastRefPos, p.pos()), this.rel);
      this.lastRefPos = p.pos();
      this.refParentOffset = null;
      this.ref = id;
      this.chain = this.chainFor(id);
      this.blend = null;
      return;
    }
  }

  /** The two frames' views drifted apart in one frame (a jump in time): finish the blend rather than drag the view. */
  private checkBlend(env: Map<string, Body>): void {
    const b = this.blend;
    if (!b) return;
    const from = env.get(b.id);
    if (from) b.lastPos = from.pos;
    const gap = this.blendGap(b, env.get(this.ref)?.pos ?? this.lastRefPos);
    if (b.gap && length(sub(gap, b.gap)) > 0.05 * this.pace) this.blend = null;
    else b.gap = gap;
  }

  private blendW(b: Blend): number {
    return b.T > 0 ? smootherstep(b.t / b.T) : 1;
  }

  /** Where the old frame would have the ship, minus where the new one has it. */
  private blendGap(b: Blend, refPos: Vec3): Vec3 {
    const fromPos = this.hooks.resolve(b.id)?.pos() ?? b.lastPos;
    return add(sub(fromPos, refPos), sub(b.fromRel, this.rel));
  }

  private step(h: number, env: Map<string, Body>): void {
    this.chooseFrame(env);
    const P = this.paceOf(env);
    this.pace = P;
    const right = normalize(cross(this.fwd, this.up));

    // What to do: the autopilot's commands, or the pilot's.
    let uT: Vec3;
    let wT: Vec3;
    let tau: number;
    const cmd = this.auto ? this.autopilot(env, P) : null;
    if (cmd) {
      uT = cmd.u;
      wT = cmd.w;
      tau = AUTO_TAU;
    } else {
      const c = this.controls;
      const mult = CRUISE * (c.boost ? BOOST : c.fine ? FINE : 1);
      uT = scale(add(add(scale(right, c.thrust[0]), scale(this.up, c.thrust[1])), scale(this.fwd, c.thrust[2])), mult);
      const tm = c.fine ? FINE_TURN : 1;
      const pitch = c.turn[0] * KEY_TURN * tm;
      const yaw = c.turn[1] * KEY_TURN * tm;
      const roll = c.turn[2] * ROLL_RATE * tm;
      wT = add(add(scale(right, pitch), scale(this.up, -yaw)), scale(this.fwd, roll));
      if (this.leveling) {
        const phi = this.rollTo(viewUp(this.hooks.resolve, this.chain, Math.max(length(this.rel), 1)));
        if (Math.abs(phi) < 0.2 * DEG) this.leveling = false;
        wT = add(wT, scale(this.fwd, clamp(AUTO_GAIN * phi, -ROLL_RATE, ROLL_RATE)));
      }
      tau = this.braking ? BRAKE : length(uT) > length(this.u) ? SPOOL : COAST;
    }

    // Attitude. Held by a drag, the view turns only with the pointer.
    if (this.grabbing && length(wT) === 0) this.spin = [0, 0, 0];
    else this.spin = add(this.spin, scale(sub(wT, this.spin), 1 - Math.exp(-h / (this.fling ? FLING_TAU : TURN_TAU))));
    if (this.fling && length(this.spin) < 1e-4) this.fling = false;
    const rv = scale(this.spin, h);
    const f = normalize(rotateBy(this.fwd, rv));
    const u = rotateBy(this.up, rv);
    this.fwd = f;
    this.up = normalize(sub(u, scale(f, dot(u, f))));

    // Translation, in pace units, so an approach slows as the surface nears and can't overshoot.
    this.u = add(this.u, scale(sub(uT, this.u), 1 - Math.exp(-h / tau)));
    const g = this.glide * (1 - Math.exp(-h / GLIDE_TAU));
    this.glide -= g;
    if (Math.abs(this.glide) < 1e-5) this.glide = 0;
    let d = scale(add(scale(this.u, h), scale(this.fwd, g)), P);
    // A hitch can't carry the ship across a body in one step.
    const dl = length(d);
    if (dl > 0.5 * P) d = scale(d, (0.5 * P) / dl);
    d = this.collide(d, h, env);
    this.move(d);
    this.speed = length(d) / h;
    this.drift = this.speed > 1e-9 * P ? normalize(d) : null;
    this.clampEdge(env);
    if (this.blend) {
      this.blend.t += h;
      if (this.blend.t >= this.blend.T) this.blend = null;
    }
  }

  private move(d: Vec3): void {
    this.rel = add(this.rel, d);
    if (this.blend) this.blend.fromRel = add(this.blend.fromRel, d);
  }

  /** Angle to roll (about the heading, right wing down +) to bring up in line with `target` seen along the heading. */
  private rollTo(target: Vec3): number {
    const t = sub(target, scale(this.fwd, dot(target, this.fwd)));
    if (length(t) < 1e-6) return 0;
    return Math.atan2(dot(cross(this.up, t), this.fwd), dot(this.up, t));
  }

  // ---- frame -------------------------------------------------------------------

  private chooseFrame(env: Map<string, Body>): void {
    if (this.hold) {
      const b = env.get(this.hold);
      if (!b || length(this.local(b, env)) > RELEASE * this.arrival(b.t)) this.hold = null;
    }
    const next = this.pickFrame(env);
    if (next !== this.ref && env.has(next)) this.rebase(next, env);
  }

  private pickFrame(env: Map<string, Body>): string {
    // A destination, or what we arrived at, claims the frame near it: that's
    // how a spacecraft or a galaxy becomes the frame, and why arriving at the
    // ISS leaves you orbiting with it.
    for (const id of [this.flying ? this.auto!.id : null, this.hold]) {
      const b = id ? env.get(id) : undefined;
      if (b && length(this.local(b, env)) < (id === this.ref ? RELEASE : CLAIM) * this.arrival(b.t)) return b.id;
    }
    // The most local body (least distance per radius), as a panned orbit view re-anchors.
    let best: { id: string; score: number } | null = null;
    let cur: number | null = null;
    for (const b of env.values()) {
      if (b.kind !== 'solid' || b.t.radius <= 0) continue;
      const d = length(this.local(b, env));
      if (d >= (b.t.handoff?.[0] ?? 1e4 * b.t.radius)) continue;
      const score = d / b.t.radius;
      if (b.id === this.ref) cur = score;
      if (!best || score < best.score) best = { id: b.id, score };
    }
    if (best) return cur !== null && best.id !== this.ref && best.score > SWITCH * cur ? this.ref : best.id;
    // Out between the stars: the innermost region we're in.
    let inner: { id: string; reach: number } | null = null;
    for (const b of env.values()) {
      if (b.kind !== 'container') continue;
      const reach = b.t.handoff?.[0] ?? Infinity;
      if (length(this.local(b, env)) < reach && (!inner || reach < inner.reach)) inner = { id: b.id, reach };
    }
    return inner?.id ?? this.ref;
  }

  /** Measure the ship from `id` instead: the same point, exactly; the view eases over to moving with it. */
  private rebase(id: string, env: Map<string, Body>): void {
    const old = env.get(this.ref);
    const next = env.get(id)!;
    const oldPos = old?.pos ?? this.lastRefPos;
    const b = this.blend;
    // Fold a blend under way into the position first: the ship is where it's drawn.
    const lnR = b ? this.blendLnR(b) : Math.log(Math.max(length(this.rel), 1));
    const chain0 = this.viewChain;
    if (b) this.rel = add(this.rel, scale(this.blendGap(b, oldPos), 1 - this.blendW(b)));
    const T = Math.abs(this.hooks.timeRate()) > 100 ? 0 : BLEND_T;
    this.blend = T > 0 ? { id: this.ref, fromRel: this.rel, lastPos: oldPos, lnR0: lnR, chain0, t: 0, T, gap: null } : null;
    this.rel = add(sub(oldPos, next.pos), this.rel);
    this.ref = id;
    this.chain = this.chainFor(id);
    this.lastRefPos = next.pos;
  }

  private blendLnR(b: Blend): number {
    const lnR = Math.log(Math.max(length(this.rel), 1));
    return b.lnR0 + (lnR - b.lnR0) * this.blendW(b);
  }

  // ---- pace, collisions, edge ------------------------------------------------------

  /** Distance to the nearest surface (m), the unit speeds are measured in. */
  private paceOf(env: Map<string, Body>): number {
    let P = Infinity;
    for (const b of env.values()) {
      const d = length(this.local(b, env));
      if (b.kind === 'point') {
        // A craft only sets the pace when it's where we're going or staying.
        if (b.id !== this.ref && b.id !== this.auto?.id && b.id !== this.hold) continue;
        P = Math.min(P, Math.max(d, b.t.minAltitude));
      } else P = Math.min(P, Math.max(d - b.t.radius, b.t.minAltitude));
    }
    // Slow toward the edge of the observable universe.
    const sun = env.get('sun');
    if (sun) {
      const x = length(this.local(sun, env));
      P = Math.min(P, Math.max(MAX_DISTANCE - x, 0.01 * MAX_DISTANCE));
      if (!Number.isFinite(P)) P = x;
    }
    return Math.max(Number.isFinite(P) ? P : 1, 1);
  }

  /**
   * Stay outside every solid body's shell (radius + closest altitude): a step
   * that would cross it stops on it but keeps its sideways part, so the ship
   * slides along instead of stopping dead. Already inside (a body swept onto
   * the ship in a jump in time), it surfaces smoothly.
   */
  private collide(d: Vec3, h: number, env: Map<string, Body>): Vec3 {
    for (const b of env.values()) {
      if (b.kind !== 'solid' || b.t.radius <= 0) continue;
      const S = b.t.radius + b.t.minAltitude;
      const q0 = this.local(b, env);
      const n0 = length(q0);
      if (n0 < S) {
        const n = n0 > 1e-9 * S ? scale(q0, 1 / n0) : scale(this.fwd, -1);
        const din = dot(d, n);
        if (din < 0) d = sub(d, scale(n, din));
        const un = dot(this.u, n);
        if (un < 0) this.u = sub(this.u, scale(n, un));
        const gap = S - n0;
        d = add(d, scale(n, gap < 1e-6 * S ? gap : gap * (1 - Math.exp(-h / 0.4))));
        continue;
      }
      // Within one closest-altitude of the shell, ease the inward motion to
      // rest at it (exponentially, like the rest of the approach) instead of
      // hitting it at speed; motion along the surface is left alone.
      const m = Math.max(b.t.minAltitude, 1e-6 * S);
      const a0 = n0 - S;
      if (a0 < m) {
        const n = scale(q0, 1 / n0);
        const din = -dot(d, n);
        if (din > 0) d = add(d, scale(n, din * (1 - a0 / m)));
      }
      const q1 = add(q0, d);
      const n1 = length(q1);
      if (n1 >= S) continue;
      const n = n1 > 1e-9 * S ? scale(q1, 1 / n1) : scale(q0, 1 / n0);
      d = sub(scale(n, S), q0);
      const un = dot(this.u, n);
      if (un < 0) this.u = sub(this.u, scale(n, un));
    }
    return d;
  }

  /** Never past the edge of the observable universe. */
  private clampEdge(env: Map<string, Body>): void {
    const sun = env.get('sun');
    if (!sun) return;
    const x = this.local(sun, env);
    const n = length(x);
    if (n <= MAX_DISTANCE) return;
    const out = scale(x, 1 / n);
    this.move(scale(out, MAX_DISTANCE - n));
    const uo = dot(this.u, out);
    if (uo > 0) this.u = sub(this.u, scale(out, uo));
  }

  // ---- autopilot -----------------------------------------------------------------

  private arrival(t: FocusTarget): number {
    const a = this.auto;
    return a && a.id === t.id && a.distance !== undefined ? a.distance : framingDistance(t, this.hooks.fovRad());
  }

  /**
   * The autopilot's drift and turn targets: face the way to the arrival point
   * (turn first, then burn), fly there at a pace that eases in exponentially,
   * go around any body in the way, and face the target over the last stretch.
   */
  private autopilot(env: Map<string, Body>, P: number): { u: Vec3; w: Vec3 } | null {
    const a = this.auto!;
    const T = env.get(a.id);
    if (!T) {
      this.auto = null;
      return null;
    }
    const q = this.local(T, env);
    const dq = length(q);
    const toT = dq > 0 ? scale(q, -1 / dq) : this.fwd;
    const upT = viewUp(this.hooks.resolve, this.chainFor(a.id), Math.max(dq, 1));
    const turnTo = (f: Vec3): Vec3 => {
      const rv = rotationBetween(this.fwd, f);
      const ang = length(rv);
      const w = ang > 1e-12 ? scale(rv, Math.min(AUTO_TURN, AUTO_GAIN * ang) / ang) : ([0, 0, 0] as Vec3);
      return add(w, scale(this.fwd, clamp(AUTO_GAIN * this.rollTo(upT), -ROLL_RATE, ROLL_RATE)));
    };

    if (a.faceOnly) {
      a.phase = 'facing';
      if (angleBetween(this.fwd, toT) < 0.2 * DEG && length(this.spin) < 0.5 * DEG) {
        this.auto = null;
        return null;
      }
      return { u: [0, 0, 0], w: turnTo(toT) };
    }

    const Ad = this.arrival(T.t);
    a.Ad = Ad;
    let side: Vec3 | null = null;
    const from = a.from ? env.get(a.from) ?? null : null;
    if (from) side = normalize(sub(from.pos, T.pos));
    else if (T.t.approach) side = normalize(T.t.approach());
    if (!side || length(side) === 0) side = dq > 0 ? scale(q, 1 / dq) : scale(this.fwd, -1);
    const e = sub(scale(side, Ad), q);
    const L = length(e);
    a.L = L;
    let hd = L > 0 ? scale(e, 1 / L) : this.fwd;
    hd = this.detour(hd, L, env);

    const near = 1 - smoothstep(Ad, 3 * Ad, L);
    const want = normalize(slerp(hd, toT, near));
    const aligned = smoothstep(Math.cos(40 * DEG), Math.cos(10 * DEG), dot(this.fwd, hd));
    const gate = Math.max(aligned, near);
    // e-folds per second: brisk across open space, gentler for the last few arrival distances.
    const rate = 3 + 2 * smoothstep(3 * Ad, 30 * Ad, L);
    const speed = Math.min((rate * L) / P, 5) * gate;
    a.phase = L < 3 * Ad ? 'arriving' : aligned < 0.5 ? 'turning' : 'cruising';

    if (L < 0.01 * Ad && angleBetween(this.fwd, toT) < 0.2 * DEG && length(this.spin) < 0.5 * DEG) {
      // Arrived: brake off the last of the approach and stay with it.
      this.auto = null;
      this.hold = T.id;
      this.braking = true;
      return null;
    }
    return { u: scale(hd, speed), w: turnTo(want) };
  }

  /** Go around the nearest body in the way: aim beside it until the way is clear. */
  private detour(hd: Vec3, L: number, env: Map<string, Body>): Vec3 {
    let hit: { along: number; aim: Vec3 } | null = null;
    for (const b of env.values()) {
      if (b.kind !== 'solid' || b.t.radius <= 0) continue;
      const S = b.t.radius + b.t.minAltitude;
      const c = scale(this.local(b, env), -1); // body, from the ship
      const along = dot(c, hd);
      if (along <= 0 || along >= L) continue;
      const off = sub(scale(hd, along), c);
      const miss = length(off);
      if (miss >= 1.5 * S || (hit && along >= hit.along)) continue;
      let away = miss > 1e-6 * S ? scale(off, 1 / miss) : normalize(sub(this.up, scale(hd, dot(this.up, hd))));
      if (length(away) === 0) away = normalize(cross(hd, [0, 0, 1]));
      hit = { along, aim: normalize(add(c, scale(away, 2 * S))) };
    }
    return hit ? hit.aim : hd;
  }

  // ---- head and pose -----------------------------------------------------------

  private stepHead(dt: number): void {
    const h = this.head;
    if (h.held) return;
    [h.yaw, h.vYaw] = spring(h.yaw, h.vYaw, dt);
    [h.pitch, h.vPitch] = spring(h.pitch, h.vPitch, dt);
    if (Math.abs(h.yaw) + Math.abs(h.pitch) < 1e-7 && Math.abs(h.vYaw) + Math.abs(h.vPitch) < 1e-6) h.yaw = h.pitch = h.vYaw = h.vPitch = 0;
  }

  /** The camera: at the ship, looking out along the heading turned by the head. */
  private compose(): CameraPose {
    const refPos = this.hooks.resolve(this.ref)?.pos() ?? this.lastRefPos;
    let off = this.rel;
    let lnR = Math.log(Math.max(length(this.rel), 1));
    const b = this.blend;
    if (b) {
      off = add(this.rel, scale(this.blendGap(b, refPos), 1 - this.blendW(b)));
      lnR = this.blendLnR(b);
    }
    const right = normalize(cross(this.fwd, this.up));
    const { yaw, pitch } = this.head;
    // Turn the neck, then nod.
    const r1 = rotateAxisAngle(right, this.up, -yaw);
    const f1 = rotateAxisAngle(this.fwd, this.up, -yaw);
    const forward = normalize(rotateAxisAngle(f1, r1, pitch));
    const up = normalize(rotateAxisAngle(this.up, r1, pitch));
    this.pose = { position: add(refPos, off), pivot: refPos, offset: off, forward, up, right: normalize(r1), r: Math.exp(lnR) };
    return this.pose;
  }
}

/** Ecliptic longitude and latitude (degrees) of a direction. */
function ecliptic(v: Vec3): ShipTelemetry['heading'] {
  const c = Math.cos(OBLIQUITY_J2000);
  const s = Math.sin(OBLIQUITY_J2000);
  const y = v[1] * c + v[2] * s;
  const z = -v[1] * s + v[2] * c;
  let lon = Math.atan2(y, v[0]) / DEG;
  if (lon < 0) lon += 360;
  return { lon, lat: Math.asin(clamp(z, -1, 1)) / DEG, system: 'ecliptic' };
}

function galactic(v: Vec3): ShipTelemetry['heading'] {
  const { l, b } = toGalactic(v);
  return { lon: l, lat: b, system: 'galactic' };
}
