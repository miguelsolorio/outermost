// The cockpit overlay in screen space: the canopy frame, the nose and drift
// markers, and the target bracket (or an arrow at the edge pointing to it).
//
// The canopy is fixed to the ship, so it's defined as directions in the
// ship's frame (azimuth and elevation, degrees) and projected through the
// camera every frame: turn your head and the frame moves the way a real one
// would, out to the side windows. Pure math, no DOM, so it can be tested.

import type { CameraPose } from './camera/controller.ts';
import { add, dot, scale, type Vec3 } from '../astro/vec.ts';

const DEG = Math.PI / 180;

export interface CockpitInput {
  pose: CameraPose;
  /** The ship's heading and up (the camera adds the head turn). */
  ship: { fwd: Vec3; up: Vec3 };
  /** Unit direction the ship is drifting, if it's moving. */
  drift: Vec3 | null;
  /** Camera-relative position of the target (m), and its distance to show. */
  target: { rel: Vec3; dist: number } | null;
  w: number;
  h: number;
  /** Vertical field of view (rad). */
  fov: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface CockpitFrame {
  w: number;
  h: number;
  /** Canopy struts, as an SVG path. */
  canopy: string;
  /** The roof, the side glass and the dash, as filled SVG paths. */
  roof: string;
  sides: string;
  dash: string;
  /** Where the nose points (off center while looking around). */
  nose: ScreenPoint | null;
  /** Where the ship is drifting. */
  drift: ScreenPoint | null;
  /** On screen: a bracket at x, y. Off screen or behind: an arrow on the edge, pointing at `angle` (rad, counterclockwise from right). */
  target: { x: number; y: number; dist: number; edge: boolean; angle: number } | null;
}

/** Keeps the target arrow this far (CSS px) inside the edges. */
export const EDGE_INSET = 48;

/** Camera-space coordinates of a direction: right, up and depth. */
function toCamera(d: Vec3, pose: CameraPose): Vec3 {
  return [dot(d, pose.right), dot(d, pose.up), dot(d, pose.forward)];
}

/** Screen position of a camera-space point in front of the camera. */
function screen(c: Vec3, w: number, h: number, f: number): ScreenPoint {
  return { x: w / 2 + (f * c[0]) / c[2], y: h / 2 - (f * c[1]) / c[2] };
}

/** Screen position of a world direction, or null behind the camera. */
export function project(d: Vec3, pose: CameraPose, w: number, h: number, fov: number): ScreenPoint | null {
  const c = toCamera(d, pose);
  if (c[2] <= 1e-6) return null;
  return screen(c, w, h, h / 2 / Math.tan(fov / 2));
}

/** A ship-frame direction from azimuth (right +) and elevation (up +), degrees. */
function shipDir(ship: CockpitInput['ship'], az: number, el: number): Vec3 {
  const right: Vec3 = [
    ship.fwd[1] * ship.up[2] - ship.fwd[2] * ship.up[1],
    ship.fwd[2] * ship.up[0] - ship.fwd[0] * ship.up[2],
    ship.fwd[0] * ship.up[1] - ship.fwd[1] * ship.up[0],
  ];
  const a = az * DEG;
  const e = el * DEG;
  return add(add(scale(right, Math.sin(a) * Math.cos(e)), scale(ship.up, Math.sin(e))), scale(ship.fwd, Math.cos(a) * Math.cos(e)));
}

/** Sample a line in (az, el) every few degrees. */
function sample(a: [number, number], b: [number, number], step = 3): Array<[number, number]> {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

/** An arc of a rounded corner, center (az, el), radius r, from angle a0 to a1 (degrees). */
function arc(c: [number, number], r: number, a0: number, a1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= 6; i++) {
    const a = (a0 + ((a1 - a0) * i) / 6) * DEG;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

const BOW = 17;
const SILL = -14;
const HALF = 30;
const CORNER = 5;
/** How far round the canopy goes (azimuth, degrees); behind that is your seat. */
const BACK = 150;

/** The windshield, a rounded rectangle, starting at the top center going clockwise (as seen). */
const WINDSHIELD: Array<[number, number]> = [
  ...sample([0, BOW], [HALF - CORNER, BOW]),
  ...arc([HALF - CORNER, BOW - CORNER], CORNER, 90, 0),
  ...sample([HALF, BOW - CORNER], [HALF, SILL + CORNER]),
  ...arc([HALF - CORNER, SILL + CORNER], CORNER, 0, -90),
  ...sample([HALF - CORNER, SILL], [-(HALF - CORNER), SILL]),
  ...arc([-(HALF - CORNER), SILL + CORNER], CORNER, -90, -180),
  ...sample([-HALF, SILL + CORNER], [-HALF, BOW - CORNER]),
  ...arc([-(HALF - CORNER), BOW - CORNER], CORNER, 180, 90),
  ...sample([-(HALF - CORNER), BOW], [0, BOW]),
];

/** The frame you see when you look around: the windshield, the roof's spine and edges, the side window posts. */
const STRUTS: Array<Array<[number, number]>> = [
  WINDSHIELD,
  sample([0, BOW], [0, 88]),
  sample([HALF - CORNER, BOW], [BACK, BOW]),
  sample([-(HALF - CORNER), BOW], [-BACK, BOW]),
  sample([HALF, SILL], [BACK, SILL]),
  sample([-HALF, SILL], [-BACK, SILL]),
  ...[75, -75, 120, -120].map((az) => sample([az, SILL], [az, BOW])),
];

/**
 * A panel between two azimuths and a list of elevations, as small tiles: a
 * tile never wraps around the view, so clipping it at the camera plane stays
 * well behaved however far you turn.
 */
function tiles(az0: number, az1: number, els: number[], step = 7.5): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = [];
  const n = Math.max(1, Math.round(Math.abs(az1 - az0) / step));
  for (let i = 0; i < n; i++) {
    const a = az0 + ((az1 - az0) * i) / n;
    const b = az0 + ((az1 - az0) * (i + 1)) / n;
    for (let j = 0; j + 1 < els.length; j++)
      out.push([
        [a, els[j]],
        [b, els[j]],
        [b, els[j + 1]],
        [a, els[j + 1]],
      ]);
  }
  return out;
}

/** The glass-free corners between the rounded windshield and the square panels around it. */
const CORNERS: Array<Array<[number, number]>> = [
  [[HALF, BOW] as [number, number], ...arc([HALF - CORNER, BOW - CORNER], CORNER, 0, 90)],
  [[HALF, SILL] as [number, number], ...arc([HALF - CORNER, SILL + CORNER], CORNER, -90, 0)],
  [[-HALF, SILL] as [number, number], ...arc([-(HALF - CORNER), SILL + CORNER], CORNER, -180, -90)],
  [[-HALF, BOW] as [number, number], ...arc([-(HALF - CORNER), BOW - CORNER], CORNER, 90, 180)],
];

/** The roof above the windshield (and the corners beside it). */
const ROOF = [...tiles(-BACK, BACK, [BOW, 40, 65, 88]), ...CORNERS];
/** Side glass, past the pillars. */
const SIDES = [...tiles(HALF, BACK, [SILL, BOW]), ...tiles(-BACK, -HALF, [SILL, BOW])];
/** The dash below the sill. */
const DASH = tiles(-BACK, BACK, [-88, -65, -40, SILL]);

/**
 * Project a ship-frame polyline, clipping where it passes behind the camera,
 * as SVG path segments.
 */
function polylinePath(pts: Array<[number, number]>, input: CockpitInput, f: number): string {
  const { pose, ship, w, h } = input;
  const near = 1e-3;
  let d = '';
  let prev: Vec3 | null = null;
  let pen = false;
  const put = (c: Vec3, move: boolean) => {
    const p = screen(c, w, h, f);
    d += `${move ? 'M' : 'L'}${clampPx(p.x)} ${clampPx(p.y)}`;
  };
  for (const [az, el] of pts) {
    const c = toCamera(shipDir(ship, az, el), pose);
    if (prev) {
      const inA = prev[2] > near;
      const inB = c[2] > near;
      if (inA !== inB) {
        const t = (near - prev[2]) / (c[2] - prev[2]);
        const x: Vec3 = [prev[0] + (c[0] - prev[0]) * t, prev[1] + (c[1] - prev[1]) * t, near];
        if (inA) put(x, false);
        else put(x, true);
        pen = inB;
      }
      if (inB) {
        put(c, !pen);
        pen = true;
      } else pen = false;
    } else if (c[2] > near) {
      put(c, true);
      pen = true;
    }
    prev = c;
  }
  return d;
}

/** Project a ship-frame polygon, clipped to what's in front of the camera, as a closed SVG path. */
function polygonPath(pts: Array<[number, number]>, input: CockpitInput, f: number): string {
  const { pose, ship, w, h } = input;
  const near = 1e-3;
  const cs = pts.map(([az, el]) => toCamera(shipDir(ship, az, el), pose));
  const out: Vec3[] = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i];
    const b = cs[(i + 1) % cs.length];
    const inA = a[2] > near;
    const inB = b[2] > near;
    if (inA) out.push(a);
    if (inA !== inB) {
      const t = (near - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near]);
    }
  }
  if (out.length < 3) return '';
  return out.map((c, i) => {
    const p = screen(c, w, h, f);
    return `${i ? 'L' : 'M'}${clampPx(p.x)} ${clampPx(p.y)}`;
  }).join('') + 'Z';
}

/** Keep far-off projections finite and short in the path string. */
const clampPx = (v: number): string => Math.max(-1e5, Math.min(1e5, v)).toFixed(1);

/** Where on the inset edge an arrow at `angle` (counterclockwise from right) sits. */
export function edgePoint(angle: number, w: number, h: number): ScreenPoint {
  const a = Math.max(w / 2 - EDGE_INSET, 1);
  const b = Math.max(h / 2 - EDGE_INSET, 1);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = Math.min(Math.abs(c) > 1e-9 ? a / Math.abs(c) : Infinity, Math.abs(s) > 1e-9 ? b / Math.abs(s) : Infinity);
  return { x: w / 2 + c * k, y: h / 2 - s * k };
}

/**
 * The canopy only depends on where you're looking relative to the ship and on
 * the viewport, so it's rebuilt only when you look around or resize.
 */
let canopyCache: { key: string; canopy: string; roof: string; sides: string; dash: string } | null = null;

function canopy(input: CockpitInput, f: number): NonNullable<typeof canopyCache> {
  const { pose, ship, w, h } = input;
  const right: Vec3 = [
    ship.fwd[1] * ship.up[2] - ship.fwd[2] * ship.up[1],
    ship.fwd[2] * ship.up[0] - ship.fwd[0] * ship.up[2],
    ship.fwd[0] * ship.up[1] - ship.fwd[1] * ship.up[0],
  ];
  const head = [dot(pose.forward, ship.fwd), dot(pose.forward, ship.up), dot(pose.forward, right), dot(pose.up, ship.up), dot(pose.up, right)];
  const key = `${head.map((x) => x.toFixed(6)).join()},${w},${h},${f.toFixed(3)}`;
  if (canopyCache?.key === key) return canopyCache;
  const fill = (polys: Array<Array<[number, number]>>) => polys.map((p) => polygonPath(p, input, f)).join('');
  canopyCache = {
    key,
    canopy: STRUTS.map((p) => polylinePath(p, input, f)).join(''),
    roof: fill(ROOF),
    sides: fill(SIDES),
    dash: fill(DASH),
  };
  return canopyCache;
}

export function buildCockpitFrame(input: CockpitInput): CockpitFrame {
  const { pose, w, h, fov } = input;
  const f = h / 2 / Math.tan(fov / 2);
  const c = canopy(input, f);
  let target: CockpitFrame['target'] = null;
  if (input.target) {
    const c = toCamera(input.target.rel, pose);
    const p = c[2] > 1e-9 * Math.hypot(c[0], c[1], c[2]) ? screen(c, w, h, f) : null;
    const inside = p && p.x >= EDGE_INSET && p.x <= w - EDGE_INSET && p.y >= EDGE_INSET && p.y <= h - EDGE_INSET;
    if (p && inside) target = { x: p.x, y: p.y, dist: input.target.dist, edge: false, angle: 0 };
    else {
      // Off screen or behind: point the way to turn. Dead astern, point down.
      const angle = Math.hypot(c[0], c[1]) > 1e-9 ? Math.atan2(c[1], c[0]) : -Math.PI / 2;
      const e = edgePoint(angle, w, h);
      target = { x: e.x, y: e.y, dist: input.target.dist, edge: true, angle };
    }
  }
  return {
    w,
    h,
    canopy: c.canopy,
    roof: c.roof,
    sides: c.sides,
    dash: c.dash,
    nose: project(input.ship.fwd, pose, w, h, fov),
    drift: input.drift ? project(input.drift, pose, w, h, fov) : null,
    target,
  };
}
