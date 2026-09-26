// Per-frame context shared by all layers.

import type * as THREE from 'three';
import type { Vec3 } from '../astro/vec.ts';
import type { CameraPose } from '../engine/camera/controller.ts';
import type { World } from './world.ts';

export interface Settings {
  labels: boolean;
  orbits: boolean;
  boost: boolean;
  constellations: boolean;
  smallBodies: boolean;
}

export interface FrameCtx {
  world: World;
  pose: CameraPose;
  /** Camera position, heliocentric m (float64). */
  cam: Vec3;
  camera: THREE.PerspectiveCamera;
  /** Viewport height in CSS pixels. */
  viewportH: number;
  viewportW: number;
  /** Vertical field of view (rad). */
  fov: number;
  /** CSS pixels per radian at the view center. */
  pxPerRad: number;
  /** Distance used as the exposure reference for sunlight (m from Sun). */
  exposureDist: number;
  /** Display brightness of the Milky Way background. */
  skyBrightness: number;
  focusId: string;
  /** Nearest solar-system body in the focus chain (e.g. 'earth' for the ISS). */
  focusBody: string;
  selectedId: string | null;
  settings: Settings;
  dt: number;
}

/** Camera-relative position as a THREE-friendly tuple (still float64 in JS). */
export const rel = (p: Vec3, cam: Vec3): Vec3 => [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
