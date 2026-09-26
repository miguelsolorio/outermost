// The real star field from HYG v4.4 (+ AT-HYG Gaia distances): 119k stars at
// their catalog 3D positions (parsecs from the Sun, J2000 equatorial axes).
// Apparent magnitude is computed per star on the GPU from absolute magnitude
// and the live camera distance, m = M + 5·log10(d / 10 pc), so the sky is
// correct from Earth and changes as you travel between the stars.

import * as THREE from 'three';
import { length } from '../../astro/vec.ts';
import { JULIAN_YEAR, PC } from '../../astro/units.ts';
import { J2000_MS } from '../../astro/time.ts';
import type { Assets } from '../../engine/assets.ts';
import { rel, type FrameCtx } from '../frame.ts';

export interface StarMeta {
  i: number;
  hip: number | null;
  name?: string;
  bayer?: string;
  flam?: string;
  con?: string;
  spect?: string;
  dist: number;
  mag: number;
  absmag: number;
  ci?: number;
  lum: number;
  distSrc: 'hip' | 'gaia' | 'override';
}

export interface StarCatalog {
  count: number;
  /** Float32 view: x, y, z (pc), absmag, vx, vy, vz (pc/yr), [color bytes]. */
  f32: Float32Array;
  u8: Uint8Array;
  meta: StarMeta[];
  byIndex: Map<number, StarMeta>;
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float absmag;
attribute vec3 vel;
attribute vec4 colorFlags;
uniform float years;       // Julian years since J2000
uniform float pc;          // meters per parsec
uniform float pixelRatio;
uniform float magLimit;
uniform float fade;
uniform float hideIndex;   // a star currently drawn as a sphere (or -1)
varying vec3 vColor;
varying float vBright;

void main() {
  vec3 p = position + vel * years;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float dpc = max(length(mv.xyz) / pc, 1e-9);
  float m = absmag + 5.0 * log2(dpc / 10.0) * 0.30103;
  // Flux relative to a magnitude-0 star.
  float flux = pow(10.0, -0.4 * m);
  // Visible stars fade out toward the limiting magnitude.
  float vis = 1.0 - smoothstep(magLimit - 1.5, magLimit, m);
  vColor = pow(colorFlags.rgb, vec3(2.2));
  // Perceptual response: the eye compresses brightness roughly as a power law,
  // so display intensity ∝ flux^0.55 keeps 6th-magnitude stars visible while
  // Sirius still dominates. Size grows gently with flux.
  float size = clamp(2.6 + 5.0 * pow(flux, 0.25), 2.6, 48.0);
  vBright = min(pow(flux, 0.55) * 1.4, 60.0) * vis * fade;
  if (vBright < 0.002 || float(gl_VertexID) == hideIndex) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * pixelRatio;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vColor;
varying float vBright;
void main() {
  #include <logdepthbuf_fragment>
  vec2 d = gl_PointCoord - 0.5;
  float r2 = dot(d, d) * 4.0;
  // Gaussian core plus a faint halo (the eye's point-spread).
  float psf = exp(-r2 * 7.0) + 0.06 * exp(-r2 * 1.5);
  float a = psf * min(vBright, 1.6);
  // Very bright stars saturate to white at the core, like the eye sees them.
  vec3 c = mix(vColor, vec3(1.0), smoothstep(1.0, 8.0, vBright) * exp(-r2 * 7.0));
  gl_FragColor = vec4(c * a * (1.0 + 0.35 * log(1.0 + vBright)), 1.0);
}
`;

export async function loadStarCatalog(assets: Assets): Promise<StarCatalog | null> {
  const [bin, metaDoc] = await Promise.all([
    assets.binary('stars/stars.bin'),
    assets.json<{ stars: StarMeta[] }>('stars/stars-meta.json'),
  ]);
  if (!bin || !metaDoc) return null;
  const header = new DataView(bin, 0, 16);
  const count = header.getUint32(4, true);
  const f32 = new Float32Array(bin, 16, count * 8);
  const u8 = new Uint8Array(bin, 16, count * 32);
  return { count, f32, u8, meta: metaDoc.stars, byIndex: new Map(metaDoc.stars.map((m) => [m.i, m])) };
}

export class StarsLayer {
  readonly points: THREE.Points;
  /** The Sun drawn as a catalog-style star once we are far from it. */
  readonly sun: THREE.Points;
  private material: THREE.ShaderMaterial;
  private sunMaterial: THREE.ShaderMaterial;
  catalog: StarCatalog | null = null;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        years: { value: 0 },
        pc: { value: PC },
        pixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
        magLimit: { value: 7.0 },
        fade: { value: 1 },
        hideIndex: { value: -1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = -10;

    // The Sun: absolute magnitude 4.83 (NSSDCA), B−V 0.65 → color from the same pipeline.
    this.sunMaterial = this.material.clone();
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    sg.setAttribute('absmag', new THREE.Float32BufferAttribute([4.83], 1));
    sg.setAttribute('vel', new THREE.Float32BufferAttribute([0, 0, 0], 3));
    sg.setAttribute('colorFlags', new THREE.Float32BufferAttribute([1.0, 0.94, 0.88, 0], 4));
    this.sun = new THREE.Points(sg, this.sunMaterial);
    this.sun.frustumCulled = false;
    this.sun.renderOrder = -9;
  }

  hide(index: number): void {
    this.material.uniforms.hideIndex.value = index;
  }

  setCatalog(cat: StarCatalog): void {
    this.catalog = cat;
    const f = new THREE.InterleavedBuffer(cat.f32, 8);
    const b = new THREE.InterleavedBuffer(cat.u8, 32);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(f, 3, 0));
    g.setAttribute('absmag', new THREE.InterleavedBufferAttribute(f, 1, 3));
    g.setAttribute('vel', new THREE.InterleavedBufferAttribute(f, 3, 4));
    g.setAttribute('colorFlags', new THREE.InterleavedBufferAttribute(b, 4, 28, true));
    this.points.geometry.dispose();
    this.points.geometry = g;
  }

  /** Star position in heliocentric meters at the given time (includes proper motion). */
  starPos(i: number, ms: number): [number, number, number] {
    const f = this.catalog!.f32;
    const yrs = (ms - J2000_MS) / 1000 / JULIAN_YEAR;
    const o = i * 8;
    return [(f[o] + f[o + 4] * yrs) * PC, (f[o + 1] + f[o + 5] * yrs) * PC, (f[o + 2] + f[o + 6] * yrs) * PC];
  }

  update(ctx: FrameCtx): void {
    if (!this.catalog) return;
    const sun = ctx.world.get('sun').pos;
    const p = rel(sun, ctx.cam);
    this.points.position.set(p[0], p[1], p[2]);
    this.points.scale.setScalar(PC);
    this.material.uniforms.years.value = (ctx.world.ms - J2000_MS) / 1000 / JULIAN_YEAR;
    // Beyond a few hundred parsecs the catalog is just the Sun's neighborhood;
    // hand over to the galaxy model.
    const fromSun = length(p) / PC;
    this.material.uniforms.fade.value = 1 - THREE.MathUtils.smoothstep(fromSun, 300, 3000);
    // Once the Sun's disk and glare are gone (beyond ~2000 AU) it becomes a star.
    this.sun.position.copy(this.points.position);
    this.sun.scale.setScalar(PC);
    const su = this.sunMaterial.uniforms;
    su.years.value = this.material.uniforms.years.value;
    su.hideIndex.value = -1;
    su.fade.value = THREE.MathUtils.smoothstep(fromSun * 206265, 1500, 8000) * this.material.uniforms.fade.value;
    this.sun.visible = su.fade.value > 0.001;
  }
}
