// Constellation figures and IAU boundaries.
// Figures connect real stars at their 3D positions, so they only look like the
// familiar shapes from near the Sun and visibly distort as you travel away.
// Boundaries are directions on the sky (J2000), drawn at "infinity" around the
// camera, and are only meaningful from within the Solar System.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { length, type Vec3 } from '../../astro/vec.ts';
import { AU, DEG, PC } from '../../astro/units.ts';
import { rel, type FrameCtx } from '../frame.ts';
import type { StarCatalog } from './stars.ts';

export interface ConstellationData {
  constellations: Array<{ abbr: string; name: string; english: string; lines: number[][] }>;
  boundaries: Array<{ cons: [string, string]; points: number[][] }>;
}

export interface ConstellationLabel {
  abbr: string;
  name: string;
  /** Unit direction from the Sun toward the figure's center. */
  dir: Vec3;
}

const SKY_RADIUS = 1e20; // meters; any large value, positioned at the camera

export class ConstellationsLayer {
  readonly group = new THREE.Group();
  private figures: LineSegments2 | null = null;
  private bounds: LineSegments2 | null = null;
  private figureMat: LineMaterial;
  private boundMat: LineMaterial;
  labels: ConstellationLabel[] = [];

  constructor() {
    this.figureMat = new LineMaterial({
      color: 0x6f9ad8,
      linewidth: 1.1,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      worldUnits: false,
    });
    this.boundMat = new LineMaterial({
      color: 0x8a7a55,
      linewidth: 0.9,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      worldUnits: false,
      dashed: false,
    });
  }

  build(data: ConstellationData, stars: StarCatalog): void {
    const f = stars.f32;
    const seg: number[] = [];
    this.labels = [];
    for (const c of data.constellations) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let n = 0;
      for (const poly of c.lines) {
        for (let k = 0; k + 1 < poly.length; k++) {
          const a = poly[k] * 8;
          const b = poly[k + 1] * 8;
          seg.push(f[a], f[a + 1], f[a + 2], f[b], f[b + 1], f[b + 2]);
        }
        for (const i of poly) {
          const o = i * 8;
          const r = Math.hypot(f[o], f[o + 1], f[o + 2]);
          sx += f[o] / r;
          sy += f[o + 1] / r;
          sz += f[o + 2] / r;
          n++;
        }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      this.labels.push({ abbr: c.abbr, name: c.name, dir: [sx / l, sy / l, sz / l] });
    }
    const fg = new LineSegmentsGeometry();
    fg.setPositions(new Float32Array(seg));
    this.figures = new LineSegments2(fg, this.figureMat);
    this.figures.frustumCulled = false;
    this.figures.renderOrder = -5;
    this.group.add(this.figures);

    const bseg: number[] = [];
    const dir = (ra: number, dec: number) => [
      Math.cos(dec * DEG) * Math.cos(ra * DEG),
      Math.cos(dec * DEG) * Math.sin(ra * DEG),
      Math.sin(dec * DEG),
    ];
    for (const b of data.boundaries) {
      const pts = b.points;
      for (let k = 0; k + 1 < pts.length; k++) bseg.push(...dir(pts[k][0], pts[k][1]), ...dir(pts[k + 1][0], pts[k + 1][1]));
    }
    const bg = new LineSegmentsGeometry();
    bg.setPositions(new Float32Array(bseg));
    this.bounds = new LineSegments2(bg, this.boundMat);
    this.bounds.frustumCulled = false;
    this.bounds.renderOrder = -6;
    this.group.add(this.bounds);
  }

  setResolution(w: number, h: number): void {
    this.figureMat.resolution.set(w, h);
    this.boundMat.resolution.set(w, h);
  }

  update(ctx: FrameCtx): void {
    const on = ctx.settings.constellations;
    this.group.visible = on && !!this.figures;
    if (!this.group.visible) return;
    const sunRel = rel(ctx.world.get('sun').pos, ctx.cam);
    const fromSun = length(sunRel);
    // Figures use real 3D star positions (pc -> m).
    this.figures!.position.set(sunRel[0], sunRel[1], sunRel[2]);
    this.figures!.scale.setScalar(PC);
    this.figureMat.opacity = 0.55 * (1 - THREE.MathUtils.smoothstep(fromSun / PC, 30, 300));
    // Boundaries live on the sky, centered on the camera.
    this.bounds!.position.set(0, 0, 0);
    this.bounds!.scale.setScalar(SKY_RADIUS);
    this.boundMat.opacity = 0.3 * (1 - THREE.MathUtils.smoothstep(fromSun / AU, 2000, 50000));
    this.bounds!.visible = this.boundMat.opacity > 0.01;
  }
}
