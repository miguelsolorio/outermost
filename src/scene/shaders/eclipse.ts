// Eclipse shading shared by the planet surface and atmosphere shaders: the
// fraction of a limb-darkened Sun visible from a point past up to four
// spherical occluders. See ../eclipse.ts for the method and its TypeScript twin.
// Must come before atmosphereChunk, whose ray march samples it.

import { SOLAR_DISKS } from '../eclipse.ts';

/** Uniforms the chunk declares; materials that include it share these objects. */
export const ECLIPSE_UNIFORMS = ['sunPos', 'sunRadius', 'occluders', 'occluderRed', 'occluderCount'] as const;

const f = (x: number) => x.toExponential(8);
const N = SOLAR_DISKS.rho.length;
const rho = SOLAR_DISKS.rho.map(f).join(', ');
const w = SOLAR_DISKS.w.map((c) => `vec3(${c.map(f).join(', ')})`).join(',\n  ');

export const eclipseChunk = /* glsl */ `
uniform vec3 sunPos;          // camera-relative position of the Sun's center (m)
uniform float sunRadius;      // m
// Bodies that can block the Sun (camera-relative center, radius in m).
uniform vec4 occluders[4];
uniform float occluderRed[4]; // > 0: sunlight refracted red through its atmosphere
uniform int occluderCount;

// The limb-darkened Sun as stacked uniform disks (radii in solar radii,
// per-channel weights), from Neckel & Labs (1994).
const int ECL_N = ${N};
const float ECL_RHO[ECL_N] = float[ECL_N](${rho});
const vec3 ECL_W[ECL_N] = vec3[ECL_N](
  ${w});

// Area of overlap of two disks (radii r1, r2, centers d apart).
float diskOverlap(float r1, float r2, float d) {
  if (d >= r1 + r2) return 0.0;
  if (d <= abs(r1 - r2)) return 3.14159265 * min(r1, r2) * min(r1, r2);
  float a = r1 * r1 * acos(clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0));
  float b = r2 * r2 * acos(clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0));
  float c = 0.5 * sqrt(max((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2), 0.0));
  return a + b - c;
}

// Fraction of sunlight (rgb) blocked by a disk of radius a whose center is s
// from the Sun's (both in solar radii).
vec3 sunBlocked(float a, float s) {
  if (s <= a - 1.0) return vec3(1.0);
  vec3 b = vec3(0.0);
  for (int i = 0; i < ECL_N; i++) b += ECL_W[i] * diskOverlap(ECL_RHO[i], a, s);
  return clamp(b, 0.0, 1.0);
}

// rgb: fraction of sunlight reaching p; a: red light bent into an occluder's
// umbra by its atmosphere (as in a lunar eclipse).
vec4 sunVisibility(vec3 p) {
  vec3 S = sunPos - p;
  float dS = length(S);
  float aS = asin(clamp(sunRadius / dS, 0.0, 1.0));
  vec3 vis = vec3(1.0);
  float red = 0.0;
  for (int k = 0; k < 4; k++) {
    if (k >= occluderCount) break;
    vec3 O = occluders[k].xyz - p;
    float dO = length(O);
    float r = occluders[k].w;
    if (dO <= r * 1.001 || dO >= dS) continue;
    float aO = asin(clamp(r / dO, 0.0, 1.0));
    // Well conditioned for small angles (acos of a dot product is not in float32).
    float sep = 2.0 * asin(min(1.0, 0.5 * length(S / dS - O / dO)));
    if (sep >= aS + aO) continue;
    vec3 blocked = sunBlocked(aO / aS, sep / aS);
    vis *= 1.0 - blocked;
    red = max(red, occluderRed[k] * blocked.g);
  }
  return vec4(vis, red);
}

// Whether the segment a-b (camera-relative m) may enter any occluder's
// penumbra: its closest approach to the shadow axis against the cone's radius
// at the segment's deepest point (conservative).
bool eclipseTouches(vec3 a, vec3 b) {
  for (int k = 0; k < 4; k++) {
    if (k >= occluderCount) break;
    vec3 C = occluders[k].xyz;
    float r = occluders[k].w;
    vec3 u = C - sunPos;
    float D = length(u);
    u /= D;
    vec3 wa = a - C;
    vec3 e = b - a;
    float za = dot(wa, u);
    float zMax = max(za, za + dot(e, u));
    if (zMax < -r) continue;
    vec3 wp = wa - za * u;
    vec3 ep = e - dot(e, u) * u;
    float t = clamp(-dot(wp, ep) / max(dot(ep, ep), 1e-6), 0.0, 1.0);
    if (length(wp + t * ep) < 1.01 * (r + max(zMax, 0.0) * (sunRadius + r) / D)) return true;
  }
  return false;
}
`;
