// Photosphere shader: limb darkening as a 5th-order polynomial in μ = cos θ,
// I(μ)/I(1) = Σ a_k μ^k, with separate coefficients for R, G, B wavelengths.
// Coefficients are set from Neckel & Labs (1994) via the `limb` uniforms.
// Catalog stars use it; the Sun itself uses the 304 Å shaders below.

import { agxChunk } from './agx.ts';
import { noiseChunk } from './noise.ts';

export const sunVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vPosW;
varying vec3 vNormalW;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

export const sunFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float intensity;
uniform vec3 tint;        // stellar color (1,1,1) for the Sun
uniform vec3 limbR[2]; // a0..a5 packed as (a0,a1,a2), (a3,a4,a5)
uniform vec3 limbG[2];
uniform vec3 limbB[2];
varying vec3 vPosW;
varying vec3 vNormalW;

float poly(vec3 lo, vec3 hi, float m) {
  float m2 = m * m;
  return lo.x + lo.y * m + lo.z * m2 + hi.x * m2 * m + hi.y * m2 * m2 + hi.z * m2 * m2 * m;
}

void main() {
  #include <logdepthbuf_fragment>
  float mu = clamp(dot(normalize(vNormalW), normalize(-vPosW)), 0.0, 1.0);
  vec3 ld = vec3(poly(limbR[0], limbR[1], mu), poly(limbG[0], limbG[1], mu), poly(limbB[0], limbB[1], mu));
  gl_FragColor = vec4(max(ld, 0.0) * tint * intensity, 1.0);
}
`;

// ---- The Sun up close: styled after SDO/AIA 304 Å ----
// Extreme-ultraviolet images of the chromosphere, shown in NASA's false-color
// orange. Procedural and animated: an artistic rendering (see its info card).
// Features are placed in body-fixed coordinates, so they turn with the Sun.

// Brightness → linear color, approximating the SDO 304 Å color table: black,
// deep red, orange, then yellow and white where active regions saturate.
// No ordinary color survives AgX tone mapping this saturated (see agx.ts), so
// the ramp is written in AgX's working space and mapped back through the
// inverse of its channel mix. On screen, x = 0.5 is deep red, 1 orange,
// 2 yellow-orange, 4 nearly white.
const sunRamp = /* glsl */ `
${agxChunk}
vec3 sunRamp(float x) {
  x = max(x, 0.0);
  vec3 u = vec3(0.75 * pow(x, 2.3), 0.168 * pow(x, 2.25) + 0.01 * pow(x, 4.0), 0.001 * pow(x, 5.0));
  return AGX_INSET_INV * u;
}
`;

export const sunSurfaceVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vObj;
void main() {
  vObj = position;
  vNormalW = normalize(mat3(modelMatrix) * position);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

export const sunSurfaceFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float intensity; // brightness of the white disk seen from afar
uniform float time;   // wall-clock seconds
uniform float look;   // 0 = a dazzling white point from afar, 1 = the 304 Å look up close
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vObj;
${noiseChunk}
${sunRamp}

void main() {
  #include <logdepthbuf_fragment>
  vec3 p = normalize(vObj);
  // Pixel footprint on the unit sphere (grows toward the limb).
  float fp = length(fwidth(vObj));
  float t = time;

  // A slowly drifting displacement field makes everything below churn in place.
  vec3 q = p * 5.0;
  float fq = fp * 5.0;
  vec3 warp = vec3(
    fbm(q + vec3(0.0, 0.0, t * 0.012), 3, fq),
    fbm(q + vec3(5.2, 1.3, 2.8) - vec3(t * 0.010, 0.0, 0.0), 3, fq),
    fbm(q + vec3(1.7, 9.2, 4.1) + vec3(0.0, t * 0.008, 0.0), 3, fq));

  // Large bright and dark patches, then fibrous mottling at smaller scales.
  float big = fbm(p * 3.0 + warp * 0.35 + 40.0, 3, fp * 3.0);
  float mottle = fbm(p * 24.0 + warp * 3.0, 8, fp * 24.0);

  // Chromospheric network: bright veins at about the supergranule scale
  // (~30 Mm, 23 per solar radius), broken up by the mottling and faded out
  // once they get small.
  float netW = 1.0 - smoothstep(0.08, 0.25, fp * 23.0);
  float wall = pow(1.0 - abs(vnoise(p * 23.0 + warp * 2.0)), 6.0) * netW * smoothstep(-0.1, 0.3, mottle);

  float I = 0.72 + 0.8 * mottle + 0.18 * wall;
  I *= 0.8 + 0.45 * big;

  // Dark filaments: sinuous ribbons along zero crossings of a noise field,
  // only in scattered patches.
  float fn = fbm(p * 4.0 + warp * 0.5 + 70.0, 3, fp * 4.0) + 0.06 * mottle;
  float fw = fwidth(fn);
  // Fade them out where they'd be thinner than a pixel (from afar, at the limb).
  float fil = (1.0 - smoothstep(0.03, 0.12 + fw, abs(fn))) * (1.0 - smoothstep(0.04, 0.12, fw));
  float filMask = smoothstep(0.35, 0.7, vnoise(p * 2.2 + 13.0));
  I *= 1.0 - 0.5 * fil * filMask;

  // Active regions: two bands at about ±20° latitude (+Z is the north pole).
  float bz = (abs(p.z) - 0.34) / 0.13;
  float band = exp(-bz * bz);
  float arN = fbm(p * 3.4 + vec3(31.0), 3, fp * 3.4);
  float ar = band * smoothstep(0.12, 0.3, arN);
  // Bright plage with loop-like streaks and flickering hot footpoints.
  // The streaks settle to their average brightness once too fine to resolve.
  float loops = fbm(p * 55.0 + warp * 2.0, 4, fp * 55.0);
  float streak = mix(0.25, pow(1.0 - abs(loops), 8.0), 1.0 - smoothstep(0.25, 0.5, fp * 55.0));
  float hot = pow(max(vnoise(p * 24.0 + vec3(t * 0.12, 0.0, 0.0)), 0.0), 3.0);
  I += ar * (0.3 + 1.1 * streak + 2.5 * hot * (0.75 + 0.25 * sin(t * 1.7 + 40.0 * arN)));

  // In 304 Å the limb brightens slightly instead of darkening.
  float mu = clamp(dot(normalize(vNormalW), normalize(-vPosW)), 0.0, 1.0);
  I *= mix(1.0, 1.2, pow(1.0 - mu, 3.0));
  // Soft-clip at pale yellow: only small hot cores cross the bloom
  // threshold (about 2), so the glow stays tight around the Sun.
  I = I < 1.5 ? I : 1.5 + 1.6 * (1.0 - exp(-(I - 1.5) / 1.6));

  // Color and contrast fade in together as the disk resolves, so bright
  // regions don't show as orange blotches on the white disk.
  vec3 col = mix(vec3(1.0, 0.97, 0.92) * intensity, sunRamp(mix(1.0, I, look)), look);
  gl_FragColor = vec4(col, 1.0);
}
`;

// A shell just above the surface, drawn additively on its back faces: for
// each view ray past the limb it finds the ray's closest approach to the Sun
// and draws the bright rim, spicules and prominences at that height. Rays
// that hit the disk are hidden by the Sun's own depth.
export const sunLimbVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vObj;
void main() {
  vObj = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const sunLimbFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float intensity;
uniform float time;
uniform vec3 camObj;  // camera position, body-fixed, in solar radii
uniform float shellR; // shell radius in solar radii
varying vec3 vObj;
${noiseChunk}
${sunRamp}

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vObj * shellR - camObj);
  vec3 P = camObj - dot(camObj, dir) * dir;
  float b = length(P);
  float h = b - 1.0;  // height of the closest approach above the surface
  if (h <= 0.0) discard;
  vec3 n = P / b;     // direction of that point, body-fixed
  float fp = max(fwidth(h), 1e-5);
  float t = time;

  // Bright thin rim of the chromosphere.
  float E = 0.8 * exp(-h / 0.01);

  // Spicules: a fringe of fine jets whose heights vary around the limb.
  // Noise sampled on direction alone stretches radially into streaks.
  float sN = vnoise(n * 140.0 + vec3(0.0, 0.0, t * 0.15));
  float sW = 1.0 - smoothstep(0.3, 0.6, fp * 140.0);
  float sH = mix(0.018, 0.018 * (0.4 + 0.9 * (0.5 + 0.5 * sN)), sW);
  E += 0.8 * exp(-h / sH);

  // Prominences: flames in scattered places, curling as they rise and
  // thinning out with height. Their threshold rises with height.
  float mask = smoothstep(0.2, 0.55, vnoise(n * 3.0 + 50.0));
  vec3 curl = vec3(vnoise(n * 6.0 + h * 6.0 + vec3(t * 0.04, 0.0, 0.0)), vnoise(n * 6.0 + h * 6.0 + vec3(0.0, t * 0.035, 7.0)), vnoise(n * 6.0 + h * 6.0 + vec3(3.0, 0.0, t * 0.03)));
  float fl = fbm(n * 22.0 + curl * 1.3 + vec3(0.0, 0.0, h * 4.0), 4, fp * 22.0);
  float prom = mask * smoothstep(h * 2.4, h * 2.4 + 0.1, fl + 0.25) * exp(-h / 0.09);
  E += 1.8 * prom;

  // A faint inner corona.
  E += 0.25 * exp(-h / 0.06);

  // Fade out well inside the shell so its edge never shows.
  E *= 1.0 - smoothstep(0.17, 0.24, h);
  gl_FragColor = vec4(sunRamp(E) * intensity, 1.0);
}
`;
