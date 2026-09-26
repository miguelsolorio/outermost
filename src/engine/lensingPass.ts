// Screen-space gravitational lensing for up to four black holes, run on the
// HDR scene before bloom. For each pixel the ray angle θ from a hole maps to
// the angle β its light really comes from, and the scene is resampled there;
// inside the shadow the pixel is black. Close to a hole β is exact for a
// non-spinning black hole (a table of corrections to the weak-field
// θ − θ_E²/θ, filled row by row as the camera moves; see LENS_LUT); farther
// out the weak field alone is used. Pixels nearer than the hole (by the depth
// buffer) are left alone. Sources that fall off screen are filled from a
// mirrored, dimmed sample.
//
// One lens may also carry an accretion disk. Its rays are traced back from
// the camera by RK4 on the exact orbit equation (astro/blackHole.ts has the
// reference): a thin disk is opaque and shows where the ray first crosses its
// plane, and so also lifted over the top and wrapped beneath the shadow; a
// thick flow (M87*, Sgr A*) is see-through and sums its glow along the ray.
// Both are Doppler-boosted and redshifted exactly; their colors are artistic.

import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { LENS_LUT, lensResidualRow } from '../astro/blackHole.ts';
import { noiseChunk, noiseTexture } from '../scene/shaders/noise.ts';
import { sunRamp } from '../scene/shaders/sun.ts';

export const MAX_LENSES = 4;

/** Crossfade cycle (r_s/c) of the orbiting disk texture: about two turns at the innermost stable orbit. */
export const DISK_CYCLE = 100;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
#ifndef PI
#define PI 3.141592653589793
#endif
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
uniform int uDiskLens;              // lens with a disk, or −1
uniform int uDiskKind;              // 0 thin, 1 thick
uniform vec3 uDiskAxis;             // view-space unit axis (angular momentum)
uniform vec3 uDiskE1;               // view-space unit vector in the disk plane, fixed to the sky
uniform vec4 uDiskParams;           // r_in, r_out, camera distance r_o (all r_s), brightness 0..1
uniform float uDiskPhase;           // sim time as a fraction of DISK_CYCLE (r_s/c units)
uniform float uDiskDTau;            // sim time this frame (r_s/c), for motion blur
varying vec2 vUv;
${noiseChunk}
${sunRamp}

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

// ---- accretion disk (units r_s = 1) ----
// The ramp keeps brightening past white (its blue grows as x⁵), so ease x
// toward 5, where it reads as white-hot.
vec3 diskRamp(float x) { return sunRamp(5.0 * (1.0 - exp(-0.2 * x))); }

// u = 1/r along the ray obeys u'' = 1.5u² − u in the azimuth φ.
vec2 orbitD(vec2 y) { return vec2(y.y, 1.5 * y.x * y.x - y.x); }
vec2 rk4(vec2 y, float h) {
  vec2 a = orbitD(y), b = orbitD(y + 0.5 * h * a), c = orbitD(y + 0.5 * h * b), d = orbitD(y + h * c);
  return y + h / 6.0 * (a + 2.0 * b + 2.0 * c + d);
}

// The gas's orbit on the sim clock, as the Sun turns: texture at radius r
// sits at angle ψ − Ω·τ, so scrubbing the timeline spins the disk at its real
// speed (Ω in rad per r_s/c). Two copies on a cycle, crossfaded, so the
// differential rotation never winds the texture up. Returns the two rotated
// angles and the crossfade weight.
vec3 orbitAngles(float psi, float om) {
  return vec3(psi - om * uDiskPhase * DISK_CYCLE, psi - om * fract(uDiskPhase + 0.5) * DISK_CYCLE, abs(2.0 * uDiskPhase - 1.0));
}
// Texture contrast left after motion blur: none once gas moves ≳ 1 rad in a frame.
float unblurred(float om) {
  return 1.0 - smoothstep(0.15, 1.0, om * uDiskDTau);
}

// Streaks riding with the gas: noise stretched along the orbit.
float streaks(float r, vec3 pd, float fp) {
  vec3 e2 = cross(uDiskAxis, uDiskE1);
  float om = inversesqrt(2.0 * r * r * r);
  float k = unblurred(om);
  if (k <= 0.0) return 1.0;
  vec3 a = orbitAngles(atan(dot(pd, e2), dot(pd, uDiskE1)), om);
  float lr = log(r / uDiskParams.x);
  float n1 = fbm(vec3(2.5 * cos(a.x), 2.5 * sin(a.x), 9.0 * lr), 5, fp);
  float n2 = fbm(vec3(2.5 * cos(a.y), 2.5 * sin(a.y), 9.0 * lr) + 31.0, 5, fp);
  return 1.0 + 0.9 * k * mix(n1, n2, a.z);
}

// Premultiplied color of a thin disk at radius r, redshift g, direction pd from the hole.
vec4 shadeThin(float r, float g, vec3 pd) {
  float rIn = uDiskParams.x, rOut = uDiskParams.y;
  float y = sqrt(rIn / r);
  float T = pow(max(y * y * y * y * y * y * (1.0 - y), 0.0) / THIN_PEAK, 0.25); // peak 1 at 49/36 r_in
  float fp = 18.0 * uPx * uDiskParams.z / r;
  // Bolometric brightness ∝ (gT)⁴: the ramp's brightness grows as x^2.3.
  float x = 2.4 * pow(g * T, 1.74) * streaks(r, pd, fp);
  float a = smoothstep(rIn, 1.04 * rIn, r) * (1.0 - smoothstep(0.55 * rOut, rOut, r)) * uDiskParams.w;
  return vec4(diskRamp(x) * a, a);
}

vec4 thinDisk(vec3 l, vec3 t, float theta) {
  float ro = uDiskParams.z, uo = 1.0 / ro;
  vec3 n = uDiskAxis;
  float ln = dot(l, n), tn = dot(t, n);
  if (abs(ln) + abs(tn) < 1e-6) return vec4(0.0); // ray plane contains the axis
  vec2 y = vec2(uo, uo * sqrt(1.0 - uo) * cos(theta) / max(sin(theta), 1e-6));
  float b = ro * sin(theta) / sqrt(1.0 - uo);
  float lam = b * dot(cross(l, t), n); // photon angular momentum about the axis
  float phi0 = atan(ln, tn);
  if (phi0 <= 0.0) phi0 += PI;
  float phi = 0.0;
  vec4 acc = vec4(0.0);
  for (int k = 0; k < MAX_CROSSINGS; k++) {
    float target = phi0 + float(k) * PI;
    float h = (target - phi) / float(DISK_STEPS);
    for (int s = 0; s < DISK_STEPS; s++) {
      y = rk4(y, h);
      if (!(y.x < 1.0) || y.x <= 0.0) return acc; // fell in (or overflowed to NaN), or escaped
    }
    phi = target;
    float r = 1.0 / y.x;
    if (r >= uDiskParams.x && r <= uDiskParams.y) {
      float g = sqrt(1.0 - 1.5 / r) / (sqrt(1.0 - uo) * (1.0 - inversesqrt(2.0 * r * r * r) * lam));
      acc += (1.0 - acc.a) * shadeThin(r, g, -l * cos(phi) + t * sin(phi));
      if (acc.a > 0.995) return acc;
    }
  }
  return acc;
}

// Optically thin hot flow: emissivity ∝ r^−2.5 in a thick torus (h/R = 0.3),
// rotating at 80% of Keplerian, summed as g³ j dl along the ray.
vec4 thickFlow(vec3 l, vec3 t, float theta) {
  float ro = uDiskParams.z, uo = 1.0 / ro, rOut = uDiskParams.y;
  vec3 n = uDiskAxis;
  vec2 y = vec2(uo, uo * sqrt(1.0 - uo) * cos(theta) / max(sin(theta), 1e-6));
  float b = ro * sin(theta) / sqrt(1.0 - uo);
  float lam = b * dot(cross(l, t), n);
  vec3 e2 = cross(n, uDiskE1);
  const float h = PI / float(THICK_STEPS_PER_PI);
  float phi = 0.0;
  float I = 0.0;
  for (int s = 0; s < 3 * THICK_STEPS_PER_PI; s++) {
    y = rk4(y, h);
    phi += h;
    if (!(y.x < 1.0) || y.x <= 0.0) break; // fell in (or overflowed to NaN), or escaped
    float r = 1.0 / y.x;
    if (r > rOut || r < 1.2) continue;
    vec3 p = (-l * cos(phi) + t * sin(phi)) * r;
    float z = dot(p, n);
    float R = max(length(p - z * n), 0.3);
    float H = 0.3 * R;
    float gz = exp(-z * z / (2.0 * H * H));
    if (gz < 0.01) continue; // well above or below the torus: nothing to add
    float j = pow(r, -2.5) * gz * (1.0 - smoothstep(0.5 * rOut, rOut, r));
    // Near the axis that would outrun light: cap the speed at 0.9 of what a static frame allows.
    float om = min(0.8 * inversesqrt(2.0 * R * R * R), 0.9 * sqrt(1.0 - 1.0 / r) / R);
    float ut = inversesqrt(1.0 - 1.0 / r - R * R * om * om);
    float g = 1.0 / (sqrt(1.0 - uo) * ut * (1.0 - om * lam));
    // Clumps carried around with the flow.
    float k = unblurred(om);
    if (k > 0.0) {
      vec3 a = orbitAngles(atan(dot(p, e2), dot(p, uDiskE1)), om);
      vec3 q = vec3(0.0, 0.0, 4.0 * log(r) + 2.0 * z / R);
      float c = mix(vnoise(q + vec3(2.0 * cos(a.x), 2.0 * sin(a.x), 0.0)), vnoise(q + vec3(2.0 * cos(a.y), 2.0 * sin(a.y), 31.0)), a.z);
      j *= 1.0 + 0.7 * k * c;
    }
    I += g * g * g * j * r * r * sqrt(y.x * y.x + y.y * y.y) * h;
  }
  // Like EHT's colormap, color runs linearly with intensity.
  return vec4(diskRamp(THICK_GAIN * I * uDiskParams.w), 0.0);
}

void main() {
  vec3 dir = normalize(vec3((vUv * 2.0 - 1.0) * uTanHalf, -1.0));
  float sceneDepth = texture2D(tDepth, vUv).r;
  vec3 src = dir;
  float shadow = 0.0;
  bool lensed = false;
  vec4 disk = vec4(0.0);
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
    if (i == uDiskLens) {
      // Skip pixels well clear of the disk's image.
      float reach = 1.3 * uDiskParams.y / uDiskParams.z;
      if (reach >= 1.0 || theta < asin(reach) + 2.0 * sqrt(uThetaE2[i])) {
        disk = uDiskKind == 0 ? thinDisk(l, t, theta) : thickFlow(l, t, theta);
      }
    }
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
  // The disk can sit in front of the shadow, so the shadow doesn't darken it.
  gl_FragColor = vec4(disk.rgb + (1.0 - disk.a) * col * (1.0 - shadow), 1.0);
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
    uDiskLens: { value: -1 },
    uDiskKind: { value: 0 },
    uDiskAxis: { value: new THREE.Vector3(0, 1, 0) },
    uDiskE1: { value: new THREE.Vector3(1, 0, 0) },
    uDiskParams: { value: new THREE.Vector4(3, 40, 40, 1) },
    uDiskPhase: { value: 0 },
    uDiskDTau: { value: 0 },
    noiseTex: { value: noiseTexture() as THREE.Texture },
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
        DISK_STEPS: 32, // RK4 steps per half turn
        MAX_CROSSINGS: 3, // direct, lifted over the top, photon ring
        THICK_STEPS_PER_PI: 40,
        DISK_CYCLE: f(DISK_CYCLE),
        THICK_GAIN: f(8),
        THIN_PEAK: f(Math.pow(6 / 7, 6) / 7),
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
