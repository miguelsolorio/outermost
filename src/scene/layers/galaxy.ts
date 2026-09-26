// The Milky Way as seen from outside: a ray-marched volume of starlight and
// dust built from the structure model (galaxy/model.ts). Emission from young
// arms, the old disk, HII regions and the bar/bulge is integrated along each
// view ray while dust absorbs it, with reddening ratios for R_V = 3.1
// (A_B : A_V : A_R ≈ 1.32 : 1 : 0.75). Midplane extinction near the Sun is
// set to ~1.5 mag/kpc, typical of the solar neighborhood.
//
// Structure finer than the density maps (star clusters, HII knots, dust
// filaments) lives on a thin sheet at the midplane, textured by a tileable
// detail map in spiral coordinates, so it stays sharp from any angle.
//
// No photograph of the Milky Way from outside exists: this is a model, and the
// info card says so. It renders into a 0.6-resolution target, composited
// behind the stars.

import * as THREE from 'three';
import { galaxyFrame } from '../../astro/galactic.ts';
import { length } from '../../astro/vec.ts';
import { KPC, PC } from '../../astro/units.ts';
import { rel, type FrameCtx } from '../frame.ts';
import { DETAIL_KU, DETAIL_M, DETAIL_PITCH, DETAIL_SIZE, MAP_EXTENT, MAP_SIZE } from '../galaxy/model.ts';

const fragment = /* glsl */ `
precision highp float;
uniform sampler2D maps;
uniform sampler2D detail;
uniform mat4 invViewProj;
uniform mat3 worldToGal;
uniform vec3 camG;          // camera in galaxy frame (kpc)
uniform float extent;       // map half-width (kpc)
uniform float brightness;
uniform vec2 barDir;
uniform float nearFade;     // kpc
uniform float pxAngle;      // radians per render-target pixel
uniform vec3 detailSpec;    // (tan pitch, K_u, M) of the detail tile
varying vec2 vNdc;

const float DETAIL_TEXELS = ${DETAIL_SIZE}.0;
const vec3 cYoung = vec3(0.30, 0.58, 1.00);
const vec3 cOld = vec3(1.00, 0.80, 0.56);
const vec3 cBulge = vec3(1.00, 0.78, 0.50);
const vec3 cHii = vec3(1.00, 0.30, 0.55);
const vec3 redden = vec3(0.75, 1.0, 1.32);

float sech2(float x) { float c = cosh(clamp(x, -20.0, 20.0)); return 1.0 / (c * c); }

// Interleaved gradient noise (Jimenez 2014) to jitter ray starts.
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

// Detail tile in log-polar spiral coordinates (see buildDetailMap), at two
// scales, filtered to the pixel footprint on the midplane.
void detailAt(vec2 xy, float footprint, out vec4 d1, out vec4 d2) {
  float R = max(length(xy), 0.05);
  float beta = atan(-xy.y, xy.x);
  vec2 uv = vec2((log(R) + beta * detailSpec.x) * detailSpec.y, beta * detailSpec.z / 6.2831853);
  float texPerKpc = DETAIL_TEXELS * max(detailSpec.y, detailSpec.z / 6.2831853) / R;
  float lod = log2(max(footprint * texPerKpc, 1.0));
  d1 = textureLod(detail, uv, lod);
  d2 = textureLod(detail, uv * 4.0 + 0.37, lod + 2.0);
}

// Share of the young-star light and dust that sits in the thin structured
// sheet (clusters, filaments) rather than the smooth layer around it.
const float SHEET = 0.6;
const float SHEET_DUST = 0.8;
const float COL_YOUNG = 2.0 * 0.06 * 1.5; // ∫ 1.5 sech²(z/0.06) dz
const float COL_DUST = 2.0 * 0.06;         // ∫ exp(-|z|/0.06) dz
const float COL_HII = 2.0 * 0.04;

vec3 emission(vec3 p, vec4 m, float structured) {
  vec2 barPerp = vec2(-barDir.y, barDir.x);
  float z = p.z;
  float young = m.r * sech2(z / 0.06) * 1.5 * (1.0 - SHEET * structured);
  float old = m.g * (sech2(z / 0.30) + 0.12 * sech2(z / 0.9));
  float hii = m.a * sech2(z / 0.04) * (1.0 - structured);
  float xb = dot(p.xy, barDir);
  float yb = dot(p.xy, barPerp);
  // Boxy/peanut bulge and the long bar (Wegg, Gerhard & Portail 2015).
  float bulge = exp(-pow(abs(xb) / 1.3, 2.2) - pow(abs(yb) / 0.8, 2.2) - pow(abs(z) / 0.55, 2.0));
  float bar = exp(-pow(abs(xb) / 4.4, 4.0)) * exp(-(yb * yb) / 0.28) * sech2(z / 0.18);
  float core = exp(-dot(p, p) / 0.02);
  return young * cYoung * 8.0 + old * cOld * 0.30 + hii * cHii * 5.0
       + (bulge * 1.1 + bar * 0.45 + core * 2.5) * cBulge;
}

// Integrate the smooth volume (emission and extinction) over [t0, t1].
void march(vec3 o, vec3 d, float t0, float t1, float n, float jitter, inout vec3 L, inout vec3 T) {
  if (t1 <= t0 || T.g < 0.003) return;
  float ds = (t1 - t0) / n;
  float t = t0 + ds * jitter;
  for (int i = 0; i < 160; i++) {
    if (float(i) >= n) break;
    vec3 p = o + d * t;
    float r = length(p.xy);
    vec4 m = texture2D(maps, p.xy / (2.0 * extent) + 0.5) * smoothstep(extent, extent - 3.0, r);
    float structured = smoothstep(0.25, 1.0, r);
    float dust = m.b * exp(-abs(p.z) / 0.06) * (1.0 - SHEET_DUST * structured);
    float fade = smoothstep(nearFade * 0.25, nearFade, distance(p, o));
    L += T * emission(p, m, structured) * fade * ds;
    T *= exp(-30.0 * dust * ds * redden);
    if (T.g < 0.003) break;
    t += ds;
  }
}

// The structured part of the thin disk as an infinitely thin sheet at z = 0:
// star clusters, HII knots and dust filaments stay sharp at any viewing angle
// instead of being smeared through the layer's thickness.
void sheet(vec3 o, vec3 d, float t, inout vec3 L, inout vec3 T) {
  if (T.g < 0.003) return;
  vec3 p = o + d * t;
  vec4 m = texture2D(maps, p.xy / (2.0 * extent) + 0.5);
  float structured = smoothstep(0.25, 1.0, length(p.xy)) * smoothstep(extent, extent - 3.0, length(p.xy));
  if (structured <= 0.0) return;
  float mu = max(abs(d.z), 0.08);
  vec4 d1, d2;
  detailAt(p.xy, t * pxAngle / sqrt(mu), d1, d2);
  float knots = d1.r + 0.7 * d2.r;
  float young = m.r * COL_YOUNG * SHEET * (0.2 + 1.3 * d1.a + 5.0 * knots);
  float hii = m.a * COL_HII * (0.3 + 4.0 * d1.r);
  float dust = m.b * COL_DUST * SHEET_DUST * (0.15 + 1.5 * d1.g + 0.7 * d2.g) * (0.4 + 1.2 * d1.b);
  vec3 e = (young * cYoung * 8.0 + hii * cHii * 5.0) * structured / mu;
  vec3 tr = exp(-30.0 * dust * structured / mu * redden);
  float fade = smoothstep(nearFade * 0.25, nearFade, t);
  L += T * e * fade * mix(vec3(1.0), tr, 0.5);
  T *= tr;
}

void main() {
  vec4 w = invViewProj * vec4(vNdc, 0.5, 1.0);
  vec3 dirW = normalize(w.xyz / w.w);
  vec3 d = worldToGal * dirW;
  vec3 o = camG;
  vec3 bmin = vec3(-extent, -extent, -3.0);
  vec3 bmax = vec3(extent, extent, 3.0);
  vec3 inv = 1.0 / d;
  vec3 t0 = (bmin - o) * inv;
  vec3 t1 = (bmax - o) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float ta = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tb = min(min(tmax.x, tmax.y), tmax.z);
  if (tb <= ta) { gl_FragColor = vec4(0.0); return; }

  // The young stars, HII regions and dust all sit within ~0.3 kpc of the
  // midplane. March that slab in fine steps (≤ 40 pc along the ray), the thick
  // disk and bulge above and below it coarsely, and the structured sheet
  // where the ray crosses z = 0.
  const float H = 0.6;
  float sa, sb, tc;
  if (abs(d.z) > 1e-5) {
    float za = (-H - o.z) / d.z;
    float zb = (H - o.z) / d.z;
    sa = min(za, zb);
    sb = max(za, zb);
    tc = -o.z / d.z;
  } else {
    sa = abs(o.z) < H ? -1e9 : 1e9;
    sb = 1e9;
    tc = -1.0;
  }
  sa = clamp(sa, ta, tb);
  sb = clamp(sb, ta, tb);
  bool crosses = tc > sa && tc < sb;
  float mid = crosses ? tc : sb;
  float jitter = ign(gl_FragCoord.xy);
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  march(o, d, ta, sa, 16.0, jitter, L, T);
  march(o, d, sa, mid, clamp(ceil((mid - sa) / 0.04), 6.0, 48.0), jitter, L, T);
  if (crosses) {
    sheet(o, d, tc, L, T);
    march(o, d, tc, sb, clamp(ceil((sb - tc) / 0.04), 6.0, 48.0), jitter, L, T);
  }
  march(o, d, sb, tb, 16.0, jitter, L, T);

  float a = 1.0 - (T.r + T.g + T.b) / 3.0;
  // Saturation lift, as in processed Hubble color composites.
  float luma = dot(L, vec3(0.2126, 0.7152, 0.0722));
  L = max(mix(vec3(luma), L, 1.35), 0.0);
  gl_FragColor = vec4(L * brightness, a * clamp(brightness * 4.0, 0.0, 1.0));
}
`;

const vertex = /* glsl */ `
varying vec2 vNdc;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class GalaxyLayer {
  readonly composite: THREE.Mesh;
  private target: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private ready = false;
  private visibleNow = false;
  private targetHeight = 1;
  readonly frame = galaxyFrame();

  constructor(private renderer: THREE.WebGLRenderer) {
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    const f = this.frame;
    // Rows of worldToGal are the galaxy axes (EQJ); THREE.Matrix3.set is row-major.
    const worldToGal = new THREE.Matrix3().set(f.x[0], f.x[1], f.x[2], f.y[0], f.y[1], f.y[2], f.z[0], f.z[1], f.z[2]);
    // Bar long axis: 27° from the Sun–center line toward the first quadrant
    // (Wegg et al. 2015). In this frame the first quadrant is −y.
    const barAngle = (27 * Math.PI) / 180;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        maps: { value: null },
        invViewProj: { value: new THREE.Matrix4() },
        worldToGal: { value: worldToGal },
        camG: { value: new THREE.Vector3() },
        extent: { value: MAP_EXTENT },
        brightness: { value: 0 },
        barDir: { value: new THREE.Vector2(Math.cos(barAngle), -Math.sin(barAngle)) },
        nearFade: { value: 1.5 },
        detail: { value: null },
        pxAngle: { value: 1e-3 },
        detailSpec: { value: new THREE.Vector3(DETAIL_PITCH, DETAIL_KU, DETAIL_M) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const quad = new THREE.Mesh(tri, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);

    this.composite = new THREE.Mesh(
      tri,
      new THREE.ShaderMaterial({
        vertexShader: `varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `uniform sampler2D tex; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tex, vUv); }`,
        uniforms: { tex: { value: this.target.texture } },
        depthTest: false,
        depthWrite: false,
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.composite.frustumCulled = false;
    this.composite.renderOrder = -90;
    this.composite.visible = false;

    const worker = new Worker(new URL('../../workers/galaxyModel.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ maps: Float32Array; detail: Uint8Array }>) => {
      const { maps, detail } = e.data;
      const half = new Uint16Array(maps.length);
      for (let i = 0; i < maps.length; i++) half[i] = THREE.DataUtils.toHalfFloat(maps[i]);
      const tex = new THREE.DataTexture(half, MAP_SIZE, MAP_SIZE, THREE.RGBAFormat, THREE.HalfFloatType);
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      const det = new THREE.DataTexture(detail, DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
      det.minFilter = THREE.LinearMipmapLinearFilter;
      det.magFilter = THREE.LinearFilter;
      det.generateMipmaps = true;
      det.wrapS = det.wrapT = THREE.RepeatWrapping;
      det.anisotropy = 4;
      det.needsUpdate = true;
      this.material.uniforms.maps.value = tex;
      this.material.uniforms.detail.value = det;
      this.ready = true;
      worker.terminate();
    };
    worker.postMessage(null);
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    const s = 0.6 * pixelRatio;
    this.target.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
    this.targetHeight = Math.max(1, Math.round(h * s));
  }

  /** Galaxy center in heliocentric meters. */
  center(): [number, number, number] {
    return this.frame.center;
  }

  update(ctx: FrameCtx): void {
    const sunRel = rel(ctx.world.get('sun').pos, ctx.cam);
    const fromSun = length(sunRel);
    // Fade in as we leave the Sun's neighborhood (the sky map covers it before that).
    const b = THREE.MathUtils.smoothstep(fromSun / PC, 150, 1500);
    this.visibleNow = this.ready && b > 0.001;
    this.composite.visible = this.visibleNow;
    if (!this.visibleNow) return;
    const u = this.material.uniforms;
    // Inside the disk, sight lines run through many kiloparsecs of stars: adapt
    // exposure down (like an eye/camera) so the view isn't a white haze.
    const camFromCenter = length(rel(this.center().map((c, i) => c + ctx.world.get('sun').pos[i]) as [number, number, number], ctx.cam)) / KPC;
    const inside = THREE.MathUtils.smoothstep(camFromCenter, 4, 40);
    u.brightness.value = b * THREE.MathUtils.lerp(0.28, 0.75, inside);
    // Camera in the galaxy frame (kpc): cam relative to the galactic center.
    const c = this.frame.center;
    const sun = ctx.world.get('sun').pos;
    const dx = ctx.cam[0] - (sun[0] + c[0]);
    const dy = ctx.cam[1] - (sun[1] + c[1]);
    const dz = ctx.cam[2] - (sun[2] + c[2]);
    const f = this.frame;
    u.camG.value.set(
      (f.x[0] * dx + f.x[1] * dy + f.x[2] * dz) / KPC,
      (f.y[0] * dx + f.y[1] * dy + f.y[2] * dz) / KPC,
      (f.z[0] * dx + f.z[1] * dy + f.z[2] * dz) / KPC,
    );
    const cam = ctx.camera;
    u.pxAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / this.targetHeight;
    const view = new THREE.Matrix4().makeRotationFromQuaternion(cam.quaternion).invert();
    u.invViewProj.value.multiplyMatrices(cam.projectionMatrix, view).invert();
  }

  /** Render the volume into its offscreen target (call before the main pass). */
  render(): void {
    if (!this.visibleNow) return;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.render(this.scene, this.ortho);
    this.renderer.setRenderTarget(prev);
    this.renderer.setClearColor(0x000000, 1);
  }
}
