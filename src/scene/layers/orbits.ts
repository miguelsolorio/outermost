// Orbit lines: the osculating Kepler ellipse from each body's current state
// vector (relative to its parent), rebuilt every frame with vertices expressed
// relative to the body itself. That keeps float32 error near the body tiny, so
// the line always passes exactly through it, even out at Neptune.
// The trail is brightest at the body and fades around the orbit behind it.

import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { cross, dot, length, normalize, scale, sub, type Vec3 } from '../../astro/vec.ts';
import { BODIES, BODY_BY_ID, meanRadius, type BodyDef } from '../catalog.ts';
import { rel, type FrameCtx } from '../frame.ts';

const SEGMENTS = 360;

interface OrbitVisual {
  def: BodyDef;
  line: LineSegments2;
  positions: Float32Array;
  colors: Float32Array;
}

const ORBIT_COLOR = new THREE.Color(0.38, 0.55, 0.85);
const MOON_ORBIT_COLOR = new THREE.Color(0.55, 0.55, 0.6);

export class OrbitsLayer {
  readonly group = new THREE.Group();
  private orbits: OrbitVisual[] = [];
  private material: LineMaterial;

  constructor() {
    this.material = new LineMaterial({
      linewidth: 1.4,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      worldUnits: false,
    });
    for (const def of BODIES) {
      if (!def.parent) continue;
      const geo = new LineSegmentsGeometry();
      const positions = new Float32Array(SEGMENTS * 6);
      const colors = new Float32Array(SEGMENTS * 6);
      geo.setPositions(positions);
      geo.setColors(colors);
      const line = new LineSegments2(geo, this.material);
      line.frustumCulled = false;
      line.renderOrder = 5;
      this.group.add(line);
      this.orbits.push({ def, line, positions, colors });
    }
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  update(ctx: FrameCtx): void {
    this.group.visible = ctx.settings.orbits;
    if (!ctx.settings.orbits) return;
    const { world, cam, pxPerRad } = ctx;
    // Focus may be a star or galaxy: then only the Sun's planets count as local.
    const focusDef = BODY_BY_ID.get(ctx.focusBody);
    const focusPlanet = !focusDef ? 'sun' : focusDef.kind === 'moon' ? focusDef.parent! : focusDef.id;
    const focusA = BODY_BY_ID.get(focusPlanet)!.semiMajorAxis || Infinity;
    for (const o of this.orbits) {
      const st = world.get(o.def.id);
      if (!st.valid) {
        o.line.visible = false;
        continue;
      }
      const parent = BODY_BY_ID.get(o.def.parent!)!;
      const mu = parent.gm + o.def.gm;
      const r = st.relPos;
      const v = st.relVel;
      const bodyCam = rel(st.pos, cam);
      const camDist = length(bodyCam);
      const parentDist = length(rel(world.get(parent.id).pos, cam));

      // Visibility: fade in when the orbit spans enough pixels; fade out when we
      // are so close to the body that the line would slice across its disk.
      const orbitPx = (o.def.semiMajorAxis / Math.max(parentDist, 1)) * pxPerRad;
      const nearFade = THREE.MathUtils.smoothstep(camDist / meanRadius(o.def), 6, 40);
      // Deep inside another planet's neighborhood, other planets' orbits all collapse
      // onto the ecliptic line and just add clutter: keep only the local system.
      const local = o.def.id === focusPlanet || o.def.parent === focusPlanet;
      const clutter = local ? 1 : THREE.MathUtils.smoothstep(ctx.pose.r, 0.02 * focusA, 0.3 * focusA);
      const alpha = THREE.MathUtils.smoothstep(orbitPx, 12, 60) * nearFade * clutter * (o.def.kind === 'moon' ? 0.6 : 1);
      o.line.visible = alpha > 0.01;
      if (!o.line.visible) continue;

      this.buildEllipse(o, r, v, mu, alpha);
      o.line.position.set(bodyCam[0], bodyCam[1], bodyCam[2]);
    }
  }

  private buildEllipse(o: OrbitVisual, r: Vec3, v: Vec3, mu: number, alpha: number): void {
    const rLen = length(r);
    const h = cross(r, v);
    const eVec = sub(scale(cross(v, h), 1 / mu), scale(r, 1 / rLen));
    const e = Math.min(length(eVec), 0.99);
    const a = 1 / (2 / rLen - dot(v, v) / mu);
    const hHat = normalize(h);
    // Perifocal basis; for near-circular orbits anchor on the current radius.
    const p = e > 1e-6 ? normalize(eVec) : normalize(r);
    const q = cross(hHat, p);
    const b = a * Math.sqrt(1 - e * e);
    // Current eccentric anomaly of the body.
    const x0 = dot(r, p);
    const y0 = dot(r, q);
    const E0 = Math.atan2(y0 / b, x0 / a + e);

    const col = o.def.kind === 'moon' ? MOON_ORBIT_COLOR : ORBIT_COLOR;
    const pos = o.positions;
    const cols = o.colors;
    let prev: Vec3 = [0, 0, 0];
    for (let i = 0; i <= SEGMENTS; i++) {
      // Walk backwards from the body so the trail fades behind it.
      const E = E0 - (i / SEGMENTS) * 2 * Math.PI;
      const cx = a * (Math.cos(E) - e);
      const cy = b * Math.sin(E);
      const pt: Vec3 = [
        cx * p[0] + cy * q[0] - r[0],
        cx * p[1] + cy * q[1] - r[1],
        cx * p[2] + cy * q[2] - r[2],
      ];
      if (i > 0) {
        const k = (i - 1) * 6;
        pos[k] = prev[0];
        pos[k + 1] = prev[1];
        pos[k + 2] = prev[2];
        pos[k + 3] = pt[0];
        pos[k + 4] = pt[1];
        pos[k + 5] = pt[2];
        const f0 = alpha * (1 - 0.8 * ((i - 1) / SEGMENTS));
        const f1 = alpha * (1 - 0.8 * (i / SEGMENTS));
        cols[k] = col.r * f0;
        cols[k + 1] = col.g * f0;
        cols[k + 2] = col.b * f0;
        cols[k + 3] = col.r * f1;
        cols[k + 4] = col.g * f1;
        cols[k + 5] = col.b * f1;
      }
      prev = pt;
    }
    // setPositions/setColors keep a reference to our Float32Arrays; just flag the upload.
    const geo = o.line.geometry as LineSegmentsGeometry;
    (geo.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
    (geo.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
  }
}
