// The viewer's own position on Earth: a pulsing marker pinned to their
// latitude and longitude, lying flat on the surface (foreshortened toward the
// limb), turning with the planet and hidden over the horizon.

import * as THREE from 'three';
import { BODY_BY_ID } from '../catalog.ts';
import { rel, type FrameCtx } from '../frame.ts';

// The time bar's Live control laid on the ground, in a brighter, fully
// saturated azure than `--accent` (hsl(205 100% 70%)) so it holds up over
// ocean, land and cloud: a tinted disc with the halo dot and a ring pulsing out
// from it. Drawn in a 64×64 box centered on the location, x east and y south;
// rings grow with SMIL so strokes stay thin.
const BLUE = '#66bfff';
const BLUE_RGB = '102 191 255';
const EASE = 'calcMode="spline" keySplines="0.2 0.6 0.4 1"';
const BREATHE = 'calcMode="spline" keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1"';
const MARKER = `
  <circle r="12" fill="none" stroke="${BLUE}" stroke-width="1.75">
    <animate attributeName="r" values="12;28" dur="2.4s" repeatCount="indefinite" ${EASE}/>
    <animate attributeName="stroke-opacity" values="1;0" dur="2.4s" repeatCount="indefinite"/>
  </circle>
  <circle r="12" fill="rgb(${BLUE_RGB} / 0.2)" stroke="rgb(${BLUE_RGB} / 0.75)" stroke-width="1"/>
  <circle r="5" fill="none" stroke="${BLUE}" stroke-width="3" stroke-opacity="0.35">
    <animate attributeName="r" values="5;6.5;5" dur="2.8s" repeatCount="indefinite" ${BREATHE}/>
    <animate attributeName="stroke-opacity" values="0.35;0.15;0.35" dur="2.8s" repeatCount="indefinite" ${BREATHE}/>
  </circle>
  <circle r="3.5" fill="${BLUE}"/>`;

const v = new THREE.Vector3();

export class UserLocationLayer {
  private el: HTMLElement;
  /** Upright "You are here" tooltip, a sibling so the ground matrix leaves it alone. */
  private tip: HTMLElement;
  /** True while the pointer or keyboard focus is on the marker's hit area. */
  private hover = false;
  private watchId: number | null = null;
  /** Geodetic latitude and longitude (rad), once the browser reports a fix. */
  private fix: { lat: number; lon: number } | null = null;
  /** Set from a link, in place of the browser's position. */
  private pinned = false;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'user-location';
    this.el.innerHTML = `<svg viewBox="-32 -32 64 64" width="64" height="64" aria-hidden="true">${MARKER}</svg><button type="button" class="hit" aria-label="Your location"></button>`;
    root.appendChild(this.el);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.el.querySelector('svg')!.pauseAnimations();
    const hit = this.el.querySelector('.hit')!;
    for (const [ev, on] of [['pointerenter', true], ['pointerleave', false], ['focus', true], ['blur', false]] as const) {
      hit.addEventListener(ev, () => (this.hover = on));
    }
    this.tip = document.createElement('div');
    this.tip.className = 'user-location-tip';
    this.tip.setAttribute('role', 'tooltip');
    this.tip.textContent = 'You are here';
    root.appendChild(this.tip);
  }

  /** Starts or stops following the browser's position (asks permission on first start). */
  setEnabled(on: boolean): void {
    if (!on) {
      if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      return;
    }
    // A pinned place needs no browser position. Automated test browsers have none and would log a denial.
    if (this.pinned || this.watchId !== null || !('geolocation' in navigator) || navigator.webdriver) return;
    this.watchId = navigator.geolocation.watchPosition(
      (p) => (this.fix = { lat: p.coords.latitude * THREE.MathUtils.DEG2RAD, lon: p.coords.longitude * THREE.MathUtils.DEG2RAD }),
      () => {
        // Denied or unavailable: keep any earlier fix, show nothing otherwise.
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 },
    );
  }

  /** Use this place (degrees) instead of the browser's position, without asking for permission. */
  pin(latDeg: number, lonDeg: number): void {
    this.pinned = true;
    this.fix = { lat: latDeg * THREE.MathUtils.DEG2RAD, lon: lonDeg * THREE.MathUtils.DEG2RAD };
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /** `earthPx` is Earth's apparent radius and `boost` its size multiplier, from the bodies layer. */
  update(ctx: FrameCtx, earthPx: number, boost: number): void {
    const st = ctx.world.get('earth');
    if (!this.fix || !ctx.settings.location || !st.valid) return this.hide();
    const [a, , c] = BODY_BY_ID.get('earth')!.radii;
    const { lat, lon } = this.fix;
    // Point on the reference ellipsoid and its local up, east and north, Earth-fixed.
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    const co = Math.cos(lon);
    const so = Math.sin(lon);
    const N = (a * a) / Math.sqrt(a * a * cl * cl + c * c * sl * sl);
    const b = [N * cl * co * boost, N * cl * so * boost, ((c * c) / (a * a)) * N * sl * boost];
    const up = [cl * co, cl * so, sl];
    const east = [-so, co, 0];
    const north = [-sl * co, -sl * so, cl];
    // Earth-fixed -> EQJ (row-major).
    const m = st.orient;
    const toEqj = (x: number[]) => [m[0] * x[0] + m[1] * x[1] + m[2] * x[2], m[3] * x[0] + m[4] * x[1] + m[5] * x[2], m[6] * x[0] + m[7] * x[1] + m[8] * x[2]];
    const e = rel(st.pos, ctx.cam);
    const pb = toEqj(b);
    const p = [e[0] + pb[0], e[1] + pb[1], e[2] + pb[2]];
    const n = toEqj(up);
    // Facing the camera: fade out as it rolls over the limb.
    const d = Math.hypot(p[0], p[1], p[2]);
    const facing = -(n[0] * p[0] + n[1] * p[1] + n[2] * p[2]) / d;
    // Once Earth is only a few dots wide the marker would cover it.
    const alpha = THREE.MathUtils.smoothstep(facing, 0, 0.12) * THREE.MathUtils.smoothstep(earthPx, 10, 28);
    if (alpha < 0.02) return this.hide();
    const s0 = this.project(ctx, p);
    if (!s0) return this.hide();
    // Lay the marker in the ground plane: the screen images of short steps
    // east and north become its x and (negated, CSS y is down) y axes.
    const step = d * 1e-4;
    const ew = toEqj(east);
    const nw = toEqj(north);
    const sE = this.project(ctx, [p[0] + ew[0] * step, p[1] + ew[1] * step, p[2] + ew[2] * step]);
    const sN = this.project(ctx, [p[0] + nw[0] * step, p[1] + nw[1] * step, p[2] + nw[2] * step]);
    if (!sE || !sN) return this.hide();
    let [ma, mb, mc, md] = [sE[0] - s0[0], sE[1] - s0[1], s0[0] - sN[0], s0[1] - sN[1]];
    // Keep its face-on size fixed: divide by the larger singular value.
    const f2 = ma * ma + mb * mb + mc * mc + md * md;
    const det = ma * md - mb * mc;
    const sMax = Math.sqrt((f2 + Math.sqrt(Math.max(0, f2 * f2 - 4 * det * det))) / 2);
    if (!(sMax > 0)) return this.hide();
    [ma, mb, mc, md] = [ma / sMax, mb / sMax, mc / sMax, md / sMax];
    this.el.style.transform = `matrix(${ma.toFixed(4)}, ${mb.toFixed(4)}, ${mc.toFixed(4)}, ${md.toFixed(4)}, ${s0[0].toFixed(1)}, ${s0[1].toFixed(1)})`;
    this.el.style.opacity = alpha.toFixed(3);
    this.el.style.visibility = 'visible';
    // The tooltip stays upright: clear the squashed marker's screen height (a
    // 13 px disc maps to an ellipse of that vertical half-extent) plus its caret.
    // It shows by itself once Earth's disk is as tall as the view.
    const near = THREE.MathUtils.smoothstep(earthPx, 0.4 * ctx.viewportH, 0.5 * ctx.viewportH);
    const lift = 13 * Math.hypot(mb, md) + 7;
    this.tip.style.transform = `translate(${s0[0].toFixed(1)}px, ${(s0[1] - lift).toFixed(1)}px)`;
    this.tip.style.opacity = (Math.max(near, this.hover ? 1 : 0) * alpha).toFixed(3);
    this.tip.style.visibility = 'visible';
  }

  /** CSS pixels of a camera-relative point, or null behind the camera. */
  private project(ctx: FrameCtx, p: number[]): [number, number] | null {
    v.set(p[0], p[1], p[2]).applyMatrix4(ctx.camera.matrixWorldInverse);
    if (v.z >= 0) return null;
    v.applyMatrix4(ctx.camera.projectionMatrix);
    return [(v.x * 0.5 + 0.5) * ctx.viewportW, (-v.y * 0.5 + 0.5) * ctx.viewportH];
  }

  private hide(): void {
    this.el.style.visibility = 'hidden';
    this.tip.style.visibility = 'hidden';
    this.tip.style.opacity = '0';
  }
}
