// The universe beyond the Milky Way: real galaxy positions from four catalogs
// and the cosmic microwave background.
//   local  UNGC + LVDB (Local Volume, ~11 Mpc): measured distances
//   2mrs   2MASS Redshift Survey: full sky out to ~300 Mpc
//   sdss   SDSS DR17 galaxies: the cosmic web in SDSS's sky footprint to z≈0.8
//   qso    SDSS DR17 quasars to z≈5 (billions of light-years)
// Positions are comoving distances (where things are "now" in the expanding
// universe), in Mpc relative to the Sun. The empty wedges are regions no survey
// covered and the Zone of Avoidance behind the Milky Way's disk, not real voids.

import * as THREE from 'three';
import { EQJ_TO_GAL } from '../../astro/galactic.ts';
import { comovingDistanceMpc, Z_STAR } from '../../astro/cosmology.ts';
import { length } from '../../astro/vec.ts';
import { MPC } from '../../astro/units.ts';
import type { Assets } from '../../engine/assets.ts';
import { rel, type FrameCtx } from '../frame.ts';

const pointVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float size;   // diameter (kpc), 0 = unknown
attribute float gtype;  // T-type; 99 unknown; -9 quasar
uniform float mpc;
uniform float pxPerRad;
uniform float pixelRatio;
uniform float alpha;
uniform float baseSize;
uniform float nearFadeMpc;
varying vec3 vColor;
varying float vA;

vec3 typeColor(float t) {
  if (t < -8.0) return vec3(0.75, 0.82, 1.0);        // quasar
  if (t > 50.0) return vec3(0.95, 0.92, 0.86);       // unknown
  if (t <= 0.0) return vec3(1.0, 0.84, 0.64);        // ellipticals/lenticulars: old, red
  if (t <= 4.0) return vec3(0.98, 0.92, 0.84);       // early spirals
  return vec3(0.78, 0.86, 1.0);                      // late spirals, irregulars: young, blue
}

void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dMpc = max(length(mv.xyz) / mpc, 1e-6);
  float diamPx = size > 0.0 ? (size / 1000.0 / dMpc) * pxPerRad : 0.0;
  float px = max(baseSize, min(diamPx, 48.0));
  // Unresolved galaxies fade with distance so the far universe doesn't wash out.
  float resolved = size > 0.0 ? clamp(diamPx / baseSize, 0.35, 1.0) : 1.0;
  float near = smoothstep(nearFadeMpc * 0.3, nearFadeMpc, dMpc);
  vA = alpha * resolved * near;
  vColor = typeColor(gtype);
  if (vA < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  gl_Position = projectionMatrix * mv;
  gl_PointSize = px * pixelRatio;
  #include <logdepthbuf_vertex>
}
`;

const pointFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vA;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  float a = exp(-r2 * 4.0) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

interface Cloud {
  name: string;
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  /** Visible range of camera distance from the Sun (Mpc): [in0, in1, out0, out1]. */
  range: [number, number, number, number];
  brightness: number;
  nearFadeMpc: number;
  /** Beyond this camera distance (Mpc) points crowd together: dim as 1/d² to avoid saturating. */
  crowdMpc: number;
}

export interface LocalGalaxy {
  name: string;
  ra: number;
  dec: number;
  dist_mpc: number;
  dist_method: string;
  T: number | null;
  diam_kpc: number | null;
  ba: number | null;
  incl_deg?: number | null;
  pa_deg?: number | null;
  BMag?: number | null;
  MV?: number | null;
  host?: string;
  src: string;
  morph?: string;
}

function parseGal(buf: ArrayBuffer): { positions: Float32Array; size: Float32Array; type: Float32Array } {
  const dv = new DataView(buf);
  const count = dv.getUint32(4, true);
  const stride = dv.getUint32(8, true);
  const positions = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const type = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const o = 12 + i * stride;
    positions[i * 3] = dv.getFloat32(o, true);
    positions[i * 3 + 1] = dv.getFloat32(o + 4, true);
    positions[i * 3 + 2] = dv.getFloat32(o + 8, true);
    size[i] = dv.getFloat32(o + 12, true);
    type[i] = dv.getInt16(o + 16, true);
  }
  return { positions, size, type };
}

const DEG = Math.PI / 180;

export class CosmosLayer {
  readonly group = new THREE.Group();
  private clouds: Cloud[] = [];
  local: LocalGalaxy[] = [];
  private cmbBack: THREE.Mesh;
  private cmbFront: THREE.Mesh;
  private cmbMat: THREE.ShaderMaterial;
  private cmbFrontMat: THREE.ShaderMaterial;
  /** Comoving distance to the last-scattering surface (m). */
  readonly dLs = comovingDistanceMpc(Z_STAR) * MPC;

  constructor(private assets: Assets) {
    const cmbVertex = /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`;
    const cmbFragment = /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D map;
      uniform bool hasMap;
      uniform mat3 toGal;
      uniform float opacity;
      varying vec3 vDir;
      void main() {
        #include <logdepthbuf_fragment>
        if (!hasMap) discard;
        vec3 g = toGal * normalize(vDir);
        float l = atan(g.y, g.x);
        if (l < 0.0) l += 6.2831853;
        float b = asin(clamp(g.z, -1.0, 1.0));
        vec3 c = texture2D(map, vec2(l / 6.2831853, 0.5 + b / 3.1415927)).rgb;
        gl_FragColor = vec4(c * opacity, opacity);
      }`;
    const m = EQJ_TO_GAL;
    const toGal = new THREE.Matrix3().set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    const mk = (side: THREE.Side) =>
      new THREE.ShaderMaterial({
        vertexShader: cmbVertex,
        fragmentShader: cmbFragment,
        uniforms: { map: { value: null }, hasMap: { value: false }, toGal: { value: toGal }, opacity: { value: 0 } },
        side,
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
    this.cmbMat = mk(THREE.BackSide);
    this.cmbFrontMat = mk(THREE.FrontSide);
    // Share the map uniform between both faces.
    this.cmbFrontMat.uniforms.map = this.cmbMat.uniforms.map;
    this.cmbFrontMat.uniforms.hasMap = this.cmbMat.uniforms.hasMap;
    const sphere = new THREE.SphereGeometry(1, 128, 64);
    this.cmbBack = new THREE.Mesh(sphere, this.cmbMat);
    this.cmbFront = new THREE.Mesh(sphere, this.cmbFrontMat);
    for (const mesh of [this.cmbBack, this.cmbFront]) {
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
    }
    this.cmbBack.renderOrder = -80;
    this.cmbFront.renderOrder = 40;
  }

  async init(): Promise<void> {
    const [localDoc, mrs, sdss, qso] = await Promise.all([
      this.assets.json<{ galaxies: LocalGalaxy[] }>('galaxies/local.json'),
      this.assets.binary('galaxies/2mrs.bin'),
      this.assets.binary('galaxies/sdss.bin'),
      this.assets.binary('galaxies/qso.bin'),
    ]);
    if (localDoc) {
      // The Milky Way is drawn by the galaxy model, not as a point.
      this.local = localDoc.galaxies.filter((g) => g.name !== 'Milky Way' && g.dist_mpc > 0.02);
      const n = this.local.length;
      const positions = new Float32Array(n * 3);
      const size = new Float32Array(n);
      const type = new Float32Array(n);
      this.local.forEach((g, i) => {
        const u = [Math.cos(g.dec * DEG) * Math.cos(g.ra * DEG), Math.cos(g.dec * DEG) * Math.sin(g.ra * DEG), Math.sin(g.dec * DEG)];
        positions.set([u[0] * g.dist_mpc, u[1] * g.dist_mpc, u[2] * g.dist_mpc], i * 3);
        size[i] = g.diam_kpc ?? 1;
        type[i] = g.T ?? 99;
      });
      this.addCloud('local', { positions, size, type }, [0.02, 0.08, 400, 1500], 1.0, 2.2, 0.01, 40);
    }
    if (mrs) this.addCloud('2mrs', parseGal(mrs), [1.5, 6, 3000, 9000], 0.9, 2.0, 0.5, 250);
    if (sdss) this.addCloud('sdss', parseGal(sdss), [25, 120, 20000, 60000], 0.55, 1.6, 5, 400);
    if (qso) this.addCloud('qso', parseGal(qso), [250, 1200, 40000, 90000], 0.5, 1.6, 50, 2500);
    const tex = await this.assets.texture('textures/cmb/8192.ktx2').then((t) => t ?? this.assets.texture('textures/cmb/4096.ktx2'));
    if (tex) {
      tex.wrapS = THREE.RepeatWrapping;
      this.cmbMat.uniforms.map.value = tex;
      this.cmbMat.uniforms.hasMap.value = true;
    }
  }

  private addCloud(
    name: string,
    d: { positions: Float32Array; size: Float32Array; type: Float32Array },
    range: [number, number, number, number],
    brightness: number,
    baseSize: number,
    nearFadeMpc: number,
    crowdMpc: number,
  ): void {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
    g.setAttribute('size', new THREE.BufferAttribute(d.size, 1));
    g.setAttribute('gtype', new THREE.BufferAttribute(d.type, 1));
    const material = new THREE.ShaderMaterial({
      vertexShader: pointVertex,
      fragmentShader: pointFragment,
      uniforms: {
        mpc: { value: MPC },
        pxPerRad: { value: 1000 },
        pixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
        alpha: { value: 0 },
        baseSize: { value: baseSize },
        nearFadeMpc: { value: nearFadeMpc },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(g, material);
    points.frustumCulled = false;
    points.renderOrder = -20;
    this.group.add(points);
    this.clouds.push({ name, points, material, range, brightness, nearFadeMpc, crowdMpc });
  }

  update(ctx: FrameCtx): void {
    const sunRel = rel(ctx.world.get('sun').pos, ctx.cam);
    const fromSunMpc = length(sunRel) / MPC;
    for (const c of this.clouds) {
      const [a0, a1, b0, b1] = c.range;
      const a =
        THREE.MathUtils.smoothstep(Math.log(fromSunMpc), Math.log(a0), Math.log(a1)) *
        (1 - THREE.MathUtils.smoothstep(Math.log(fromSunMpc), Math.log(b0), Math.log(b1)));
      c.points.visible = a > 0.002;
      if (!c.points.visible) continue;
      c.points.position.set(sunRel[0], sunRel[1], sunRel[2]);
      c.points.scale.setScalar(MPC);
      const crowd = Math.min(1, (c.crowdMpc / fromSunMpc) ** 2);
      c.material.uniforms.alpha.value = a * c.brightness * Math.max(crowd, 0.02);
      c.material.uniforms.pxPerRad.value = ctx.pxPerRad;
    }
    // CMB: shown (in false color) only at cosmological zoom, centered on us.
    const fromSun = length(sunRel);
    const show = THREE.MathUtils.smoothstep(Math.log(fromSun), Math.log(0.15 * this.dLs), Math.log(0.6 * this.dLs));
    const outside = THREE.MathUtils.smoothstep(fromSun, this.dLs * 0.98, this.dLs * 1.15);
    for (const mesh of [this.cmbBack, this.cmbFront]) {
      mesh.position.set(sunRel[0], sunRel[1], sunRel[2]);
      mesh.scale.setScalar(this.dLs);
    }
    this.cmbMat.uniforms.opacity.value = show * 0.9;
    this.cmbFrontMat.uniforms.opacity.value = show * outside * 0.3;
    this.cmbBack.visible = show > 0.002;
    this.cmbFront.visible = show * outside > 0.002;
  }
}
