// Screen-space gravitational lensing for up to four black holes, run on the
// HDR scene before bloom. For each pixel the ray angle θ from a hole maps to
// the angle β its light really comes from, and the scene is resampled there;
// inside the shadow the pixel is black. Close to a hole β is exact for a
// non-spinning black hole (a table of corrections to the weak-field
// θ − θ_E²/θ, filled row by row as the camera moves; see LENS_LUT); farther
// out the weak field alone is used. Pixels nearer than the hole (by the depth
// buffer) are left alone. Sources that fall off screen are filled from a
// mirrored, dimmed sample.

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { LENS_LUT, lensResidualRow } from '../astro/blackHole.ts';

export const MAX_LENSES = 4;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform sampler2D uLut;             // exact − weak-field β, LUT_N × LUT_ROWS
uniform int uCount;
uniform vec3 uDir[MAX_LENSES];      // view-space unit vector to each hole
uniform float uThetaE2[MAX_LENSES]; // Einstein angle squared (rad²)
uniform float uShadow[MAX_LENSES];  // shadow angular radius (rad)
uniform float uDepth[MAX_LENSES];   // depth-buffer value at the hole
uniform float uRow[MAX_LENSES];     // fractional table row, or −1 for weak field only
uniform vec2 uTanHalf;              // tan(fov/2)·aspect, tan(fov/2)
uniform float uPx;                  // radians per pixel
varying vec2 vUv;

// Scene color along a view direction. Off screen (or behind the camera) there
// is nothing to sample, so a mirrored, dimmed stand-in fills in.
vec3 sampleDir(vec3 d) {
  float behind = step(-1e-4, d.z);
  vec2 uv = (d.xy / max(abs(d.z), 1e-4)) / uTanHalf * 0.5 + 0.5;
  vec2 m = abs(mod(uv + 1.0, 2.0) - 1.0);
  float outside = max(max(-uv.x, uv.x - 1.0), max(-uv.y, uv.y - 1.0));
  float k = mix(mix(1.0, 0.35, smoothstep(0.0, 0.08, outside)), 0.25, behind);
  return texture2D(tDiffuse, m).rgb * k;
}

float lut(int j, int row) {
  return texelFetch(uLut, ivec2(j, row), 0).r;
}

void main() {
  vec3 dir = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0));
  float sceneDepth = texture2D(tDepth, vUv).r;
  vec3 src = dir;
  float shadow = 0.0;
  bool lensed = false;
  for (int i = 0; i < MAX_LENSES; i++) {
    if (i >= uCount) break;
#ifdef REVERSED_DEPTH
    if (sceneDepth > uDepth[i]) continue; // in front of the hole
#else
    if (sceneDepth < uDepth[i]) continue;
#endif
    vec3 l = uDir[i];
    float c = dot(src, l);
    vec3 perp = src - l * c;
    float s = length(perp);
    float theta = atan(s, c);
    vec3 t = s > 1e-12 ? perp / s : vec3(0.0);
    float sh = uShadow[i];
    shadow = max(shadow, 1.0 - smoothstep(sh - 0.5 * uPx, sh + 0.5 * uPx, theta));
    float beta = theta - uThetaE2[i] / max(theta, 1e-12);
    if (uRow[i] >= 0.0) {
      float q = log(max(theta / sh - 1.0, 1e-6));
      float x = clamp((q - LUT_Q0) / (LUT_Q1 - LUT_Q0), 0.0, 1.0) * float(LUT_N - 1);
      int j = min(int(x), LUT_N - 2);
      float fx = x - float(j);
      int r0 = min(int(uRow[i]), LUT_ROWS - 1);
      int r1 = min(r0 + 1, LUT_ROWS - 1);
      float fr = uRow[i] - float(r0);
      float a = mix(lut(j, r0), lut(j + 1, r0), fx);
      float b = mix(lut(j, r1), lut(j + 1, r1), fx);
      beta += mix(a, b, fr);
    }
    src = l * cos(beta) + t * sin(beta);
    lensed = true;
  }
  vec3 col = lensed ? sampleDir(src) : texture2D(tDiffuse, vUv).rgb;
  gl_FragColor = vec4(col * (1.0 - shadow), 1.0);
}
`;

export class LensingPass extends Pass {
  private lutData = new Float32Array(LENS_LUT.n * LENS_LUT.rows);
  private lutReady = new Array<boolean>(LENS_LUT.rows).fill(false);
  private lut = new THREE.DataTexture(this.lutData, LENS_LUT.n, LENS_LUT.rows, THREE.RedFormat, THREE.FloatType);
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uLut: { value: this.lut as THREE.Texture },
    uCount: { value: 0 },
    uDir: { value: Array.from({ length: MAX_LENSES }, () => new THREE.Vector3()) },
    uThetaE2: { value: new Array<number>(MAX_LENSES).fill(0) },
    uShadow: { value: new Array<number>(MAX_LENSES).fill(0) },
    uDepth: { value: new Array<number>(MAX_LENSES).fill(0) },
    uRow: { value: new Array<number>(MAX_LENSES).fill(-1) },
    uTanHalf: { value: new THREE.Vector2(1, 1) },
    uPx: { value: 1e-3 },
  };
  private material: THREE.ShaderMaterial;
  private quad: FullScreenQuad;

  constructor(reversedDepth: boolean) {
    super();
    this.needsSwap = true;
    this.enabled = false;
    this.lut.minFilter = this.lut.magFilter = THREE.NearestFilter;
    const f = (x: number) => x.toFixed(8);
    this.material = new THREE.ShaderMaterial({
      defines: {
        MAX_LENSES,
        LUT_N: LENS_LUT.n,
        LUT_ROWS: LENS_LUT.rows,
        LUT_Q0: f(LENS_LUT.q0),
        LUT_Q1: f(LENS_LUT.q1),
        ...(reversedDepth ? { REVERSED_DEPTH: '' } : {}),
      },
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Make sure the table rows around a fractional row exist (each takes a few ms, once). */
  ensureRows(row: number): void {
    if (row < 0) return;
    for (const r of [Math.floor(row), Math.min(Math.floor(row) + 1, LENS_LUT.rows - 1)]) {
      if (this.lutReady[r]) continue;
      this.lutData.set(lensResidualRow(r), r * LENS_LUT.n);
      this.lutReady[r] = true;
      this.lut.needsUpdate = true;
    }
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.material.dispose();
    this.quad.dispose();
    this.lut.dispose();
  }
}
