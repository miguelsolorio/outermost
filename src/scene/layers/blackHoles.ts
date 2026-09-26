// Picks the black holes that visibly bend the view this frame and hands them
// to the lensing pass: the Einstein angle has to reach most of a pixel, and
// the hole's pull (θ_E²/θ) has to reach the screen. Strongest first.

import { einsteinAngle, lensRow, shadowAngularRadius } from '../../astro/blackHole.ts';
import { clamp, cross, dot, length, normalize, scale, type Vec3 } from '../../astro/vec.ts';
import { C } from '../../astro/units.ts';
import { DISK_CYCLE, MAX_LENSES, type LensingPass } from '../../engine/lensingPass.ts';
import type { DepthMode } from '../../engine/renderer.ts';
import type { FrameCtx } from '../frame.ts';
import type { LensDisk, LensSource } from '../providers/blackHoles.ts';

export interface Lens {
  id: string;
  /** View-space unit vector (camera looks down −z). */
  dir: Vec3;
  /** Distance along the view axis (m); negative behind the camera. */
  z: number;
  thetaE: number;
  shadow: number;
  /** Row of the exact-bending table, or −1 where the weak field suffices. */
  row: number;
  /** Shining accretion disk, axis in view space; ro is the camera distance in r_s. */
  disk?: LensDisk & { ro: number };
}

/** Beyond this camera distance (r_s; the exact-bending table's last row) every disk is under a pixel. */
const DISK_MAX_RO = 1e4;

/** Index of the lens whose disk gets drawn: the first with one wider than about 2 px, or −1. */
export function diskLensIndex(lenses: Lens[], radPerPx: number): number {
  return lenses.findIndex((l) => l.disk && l.disk.ro < DISK_MAX_RO && Math.asin(Math.min(1, l.disk.rOut / l.disk.ro)) > 2 * radPerPx);
}

/** Depth-buffer value of a point at view depth z, matching three's reversed-Z and logarithmic depth. */
export function lensDepth(z: number, near: number, far: number, mode: DepthMode): number {
  // Behind the camera nothing on screen is in front of the hole.
  if (z <= 0) return mode === 'reversed' ? 2 : -1;
  return mode === 'reversed' ? (near / (far - near)) * (far / z - 1) : Math.log2(1 + z) / Math.log2(far + 1);
}

/** Holes (with view-space positions) that visibly lens the screen, strongest first. */
export function selectLenses(
  sources: Array<{ id: string; rs: number; view: Vec3 }>,
  radPerPx: number,
  halfDiag: number,
  max = MAX_LENSES,
): Lens[] {
  const out: Lens[] = [];
  for (const s of sources) {
    const D = length(s.view);
    if (!(D > 1.01 * s.rs)) continue;
    const thetaE = einsteinAngle(s.rs, D);
    if (thetaE < 0.75 * radPerPx) continue;
    const dir = scale(s.view, 1 / D);
    const off = Math.acos(clamp(-dir[2], -1, 1));
    // Deflection falls off as θ_E²/θ: skip holes that can't move anything on screen by half a pixel.
    if (off - halfDiag > (thetaE * thetaE) / (0.5 * radPerPx)) continue;
    out.push({ id: s.id, dir, z: -s.view[2], thetaE, shadow: shadowAngularRadius(s.rs, D), row: lensRow(D / s.rs) });
  }
  return out.sort((a, b) => b.thetaE - a.thetaE).slice(0, max);
}

export class BlackHoleLayer {
  lenses: Lens[] = [];
  private pose: FrameCtx['pose'] | null = null;
  private lastMs: number | null = null;

  constructor(
    private pass: LensingPass,
    private depthMode: DepthMode,
    private pixelRatio: number,
  ) {}

  update(ctx: FrameCtx, sources: LensSource[]): void {
    const { pose, camera } = ctx;
    this.pose = pose;
    const radPerPx = ctx.fov / (ctx.viewportH * this.pixelRatio);
    const tanV = Math.tan(ctx.fov / 2);
    const tanH = tanV * camera.aspect;
    const halfDiag = Math.atan(Math.hypot(tanV, tanH));
    // View space from the pose basis in float64 (the three.js camera is built from the same basis).
    const toView = (v: Vec3): Vec3 => [dot(v, pose.right), dot(v, pose.up), -dot(v, pose.forward)];
    const view = sources.map((s) => ({ id: s.id, rs: s.rs, view: toView(s.rel) }));
    this.lenses = selectLenses(view, radPerPx, halfDiag);
    for (const l of this.lenses) {
      const s = sources.find((x) => x.id === l.id)!;
      if (s.disk) l.disk = { ...s.disk, axis: toView(s.disk.axis), ro: length(s.rel) / s.rs };
    }
    const u = this.pass.uniforms;
    const k = diskLensIndex(this.lenses, radPerPx);
    u.uDiskLens.value = k;
    if (k >= 0) {
      const d = this.lenses[k].disk!;
      const src = sources.find((x) => x.id === this.lenses[k].id)!.disk!;
      // A reference direction in the disk plane fixed to the sky, so the streaks don't swim as the camera turns.
      let e1 = cross(src.axis, [0, 0, 1]);
      if (length(e1) < 1e-6) e1 = cross(src.axis, [1, 0, 0]);
      e1 = toView(normalize(e1));
      u.uDiskAxis.value.set(d.axis[0], d.axis[1], d.axis[2]);
      u.uDiskE1.value.set(e1[0], e1[1], e1[2]);
      u.uDiskParams.value.set(d.rIn, d.rOut, d.ro, d.brightness);
      u.uDiskKind.value = d.kind === 'thick' ? 1 : 0;
      // Sim time in the hole's own unit r_s/c, wrapped in float64 so the GPU keeps precision.
      const rs = sources.find((x) => x.id === this.lenses[k].id)!.rs;
      const tau = ((ctx.world.ms / 1000) * C) / rs;
      u.uDiskPhase.value = tau / DISK_CYCLE - Math.floor(tau / DISK_CYCLE);
      u.uDiskDTau.value = this.lastMs === null ? 0 : (Math.abs(ctx.world.ms - this.lastMs) / 1000) * (C / rs);
    }
    this.lenses.forEach((l, i) => {
      u.uDir.value[i].set(l.dir[0], l.dir[1], l.dir[2]);
      u.uThetaE2.value[i] = l.thetaE * l.thetaE;
      u.uShadow.value[i] = l.shadow;
      u.uDepth.value[i] = lensDepth(l.z, camera.near, camera.far, this.depthMode);
      this.pass.ensureRows(l.row);
      u.uRow.value[i] = l.row;
    });
    u.uCount.value = this.lenses.length;
    u.uTanHalf.value.set(tanH, tanV);
    u.uPx.value = radPerPx;
    this.pass.enabled = this.lenses.length > 0;
    this.lastMs = ctx.world.ms;
  }

  /**
   * Whether a camera-relative point sits inside a lens's Einstein ring, where
   * the lens moves its image elsewhere (so a label there would mislead).
   */
  hides(rel: Vec3): boolean {
    if (!this.pose || this.lenses.length === 0) return false;
    const d = length(rel);
    if (!(d > 0)) return false;
    const v: Vec3 = [dot(rel, this.pose.right) / d, dot(rel, this.pose.up) / d, -dot(rel, this.pose.forward) / d];
    return this.lenses.some((l) => l.z > 0 && d > l.z && Math.acos(clamp(dot(v, l.dir), -1, 1)) < 1.2 * l.thetaE);
  }
}
