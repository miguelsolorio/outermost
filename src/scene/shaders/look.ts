// Enhanced planet looks (see scene/looks.ts): a color grade in the style of
// NASA's enhanced press images, and animated atmospheres. Pasted into the
// planet shader; with the default uniforms (atmo = 0, identity grade) it
// changes nothing, so moons render as before.
//
// Winds drift features east or west by latitude. A pure zonal drift would
// shear storms into streaks over time, so two copies of the flow run half a
// cycle apart, each restarting every FLOW_PERIOD seconds, and crossfade
// (the usual flow-map trick). Blending two offset copies of an image ghosts
// it, so a map only drifts a little; most of the motion comes from eddies, a
// displacement field that flows with the winds (blending two noise fields is
// just another smooth field) and that the map is read through once.
// Discrete storms drift continuously at their own latitude's speed, which
// never shears them.

import { agxChunk } from './agx.ts';
import { noiseChunk } from './noise.ts';

export const lookChunk = /* glsl */ `
${noiseChunk}
${agxChunk}
uniform float time;         // wall-clock seconds
uniform int atmo;           // 0 none, 1 flowing map, 2 flowing clouds, 3 Venus, 4 Uranus, 5 Neptune
uniform vec4 jetA;          // constant, equatorial jet, its half-width (rad), polar term (× sin²φ)
uniform vec2 jetB;          // alternating jets: height, frequency (per rad of latitude)
uniform float flowSpeed;    // longitude drift, rad/s per unit of wind
uniform float turbAmp;      // swirl displacement (rad)
uniform float gradeSat;
uniform float gradeContrast;
uniform vec3 gradeGain;
uniform float gradeSharp;
uniform float gradeVivid;
uniform vec4 poleTint;      // color blended in toward the poles (at the same brightness), strength

// Zonal wind (arbitrary units, + = east) at latitude lat.
float jet(float lat) {
  float s = sin(lat);
  return jetA.x + jetA.y * exp(-lat * lat / (jetA.z * jetA.z)) + jetA.w * s * s + jetB.x * cos(jetB.y * lat);
}

// Longitude shifts (rad) of the two flow copies and the weight of the second,
// for features carried rate times as fast as the map itself.
const float FLOW_PERIOD = 20.0;
vec3 flowPhases(float lat, float rate) {
  float a = fract(time / FLOW_PERIOD);
  float b = fract(a + 0.5);
  float drift = jet(lat) * flowSpeed * FLOW_PERIOD * rate;
  // Each copy is weighted zero at the moment it restarts.
  return vec3((a - 0.5) * drift, (b - 0.5) * drift, abs(2.0 * a - 1.0));
}

vec3 rotZ(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// Eddies: a churning displacement field (east, north).
vec2 eddies(vec3 q, float fp) {
  vec3 s = q * 9.0 + vec3(0.0, 0.0, time * 0.02);
  return vec2(fbm(s, 3, fp * 9.0), fbm(s + vec3(11.3, 4.1, 7.7), 3, fp * 9.0));
}

// Eddies carried along by the winds, as a texture-coordinate shift that
// fades at the poles.
vec2 swirlUv(vec3 p, float lat, float fp) {
  vec3 fe = flowPhases(lat, 6.0);
  vec2 d = turbAmp * mix(eddies(rotZ(p, fe.x), fp), eddies(rotZ(p, fe.y), fp), fe.z);
  d *= 1.0 - smoothstep(0.8, 0.97, abs(p.z));
  return vec2(d.x / (PI2 * max(cos(lat), 0.1)), d.y / PI);
}

vec3 gradeColor(vec3 c) {
  c = max(mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, gradeSat), 0.0);
  // Contrast around a middling albedo.
  c = 0.2 * pow(c / 0.2, vec3(gradeContrast));
  return c * gradeGain;
}

// ---- Procedural atmospheres (Venus, Uranus, Neptune) ----

vec3 dirAt(float lat, float lon) {
  return vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
}

// Noise stretched along longitude, for zonal bands and streaks.
float zonal(vec3 p, float k, float stretch, int octaves, float fp) {
  return fbm(vec3(p.xy * k, p.z * k * stretch), octaves, fp * k * stretch);
}

// Offset of p from c in c's local (east, north) frame, in radians; far away
// (including the opposite side) it reads as far outside any feature.
vec2 localOffset(vec3 p, vec3 c) {
  if (dot(p, c) < 0.8) return vec2(10.0);
  vec3 e = normalize(vec3(-c.y, c.x, 0.0));
  vec3 n = cross(c, e);
  return vec2(dot(p - c, e), dot(p - c, n));
}

// Center of a storm at latitude lat, drifting with the wind there.
vec3 stormAt(float lat, float lon0) {
  return dirAt(lat, lon0 + jet(lat) * flowSpeed * time);
}

// Squared elliptical distance: < 1 inside semi-axes (east, north).
float ellipse(vec2 d, vec2 axes) {
  vec2 q = d / axes;
  return dot(q, q);
}

// A Gaussian band of latitude centered on c, half-width w.
float band(float lat, float c, float w) {
  float d = (lat - c) / w;
  return exp(-d * d);
}

vec3 srgb(float r, float g, float b) {
  return pow(vec3(r, g, b) / 255.0, vec3(2.2));
}

// Venus in ultraviolet: dark streaks bent into chevrons (a sideways "Y") on a
// pale cloud deck, bright toward the poles.
float venusField(vec3 q, float lat, float fp) {
  return zonal(rotZ(q, 1.4 * abs(lat)), 2.5, 4.0, 5, fp);
}
vec3 venusAlbedo(vec3 p, float lat, vec3 fl, float fp) {
  float f = mix(venusField(rotZ(p, fl.x), lat, fp), venusField(rotZ(p, fl.y), lat, fp), fl.z);
  float dark = smoothstep(-0.1, 0.4, f) * (1.0 - smoothstep(0.7, 1.1, abs(lat)));
  vec3 c = mix(srgb(238.0, 222.0, 180.0), srgb(190.0, 150.0, 95.0), 0.55 * dark);
  return mix(c, srgb(245.0, 238.0, 215.0), smoothstep(0.9, 1.25, abs(lat)));
}

// Uranus as Voyager 2 showed it, enhanced: cyan with faint bands, a bright
// north polar cap and a few bright clouds.
vec2 uranusField(vec3 q, float fp) {
  return vec2(zonal(q, 3.0, 6.0, 4, fp), zonal(q + vec3(3.3, 8.1, 1.7), 8.0, 8.0, 3, fp));
}
vec3 uranusAlbedo(vec3 p, float lat, vec3 fl, float fp) {
  vec2 f = mix(uranusField(rotZ(p, fl.x), fp), uranusField(rotZ(p, fl.y), fp), fl.z);
  float bands = clamp(0.5 + 0.15 * cos(lat * 8.0) + 0.6 * f.x, 0.0, 1.0);
  vec3 c = mix(srgb(95.0, 180.0, 205.0), srgb(140.0, 215.0, 228.0), bands);
  c = mix(c, srgb(200.0, 238.0, 240.0), smoothstep(0.85, 1.15, lat));
  float belt = band(lat, 0.5, 0.12) + band(lat, -0.45, 0.1);
  return mix(c, vec3(0.85, 0.95, 1.0), 0.8 * belt * smoothstep(0.35, 0.55, f.y));
}

// Neptune as Voyager 2 showed it in 1989, enhanced: deep azure bands, bright
// methane cirrus, and the storms that drift past each other at their own
// latitudes' speeds (the Great Dark Spot, the Scooter and dark spot D2).
vec2 neptuneField(vec3 q, float fp) {
  return vec2(zonal(q, 3.0, 5.0, 4, fp), zonal(q + vec3(5.1, 2.3, 7.7), 7.0, 9.0, 3, fp));
}
vec3 neptuneAlbedo(vec3 p, float lat, vec3 fl, float fp) {
  vec2 f = mix(neptuneField(rotZ(p, fl.x), fp), neptuneField(rotZ(p, fl.y), fp), fl.z);
  vec3 dark = srgb(28.0, 40.0, 150.0);
  vec3 white = srgb(225.0, 235.0, 255.0);
  float bands = clamp(0.5 + 0.25 * cos(lat * 5.0) + 0.5 * f.x, 0.0, 1.0);
  vec3 c = mix(srgb(38.0, 50.0, 205.0), srgb(66.0, 92.0, 235.0), bands);
  // A darker band near 65°S.
  c = mix(c, dark, 0.6 * band(lat, -1.12, 0.12));
  // Thin bright cirrus, mostly near 25°N and 25-45°S.
  float belt = band(lat, 0.45, 0.1) + 0.8 * band(lat, -0.55, 0.15);
  c = mix(c, white, belt * smoothstep(0.22, 0.45, f.y));

  // Great Dark Spot near 22°S: a dark oval whose shape wobbled, with bright
  // companion clouds curving along its southern edge.
  vec2 g = localOffset(p, stormAt(-0.38, 1.0));
  float wob = 1.0 + 0.12 * sin(time * 0.4);
  c = mix(c, dark * 0.7, smoothstep(1.0, 0.35, ellipse(g, vec2(0.2 * wob, 0.09 / wob)) + 0.3 * f.x));
  vec2 gc = g - vec2(-0.03, -0.1 + 1.2 * g.x * g.x);
  c = mix(c, white, 0.9 * smoothstep(1.0, 0.2, ellipse(gc, vec2(0.14, 0.022))));
  // The Scooter near 42°S: a small bright cloud.
  vec2 s = localOffset(p, stormAt(-0.73, 2.6));
  c = mix(c, white, 0.85 * smoothstep(1.0, 0.2, ellipse(s, vec2(0.06, 0.025))));
  // Dark spot D2 near 55°S, with a bright core.
  vec2 d2 = localOffset(p, stormAt(-0.96, 4.2));
  c = mix(c, dark * 0.8, smoothstep(1.0, 0.3, ellipse(d2, vec2(0.07, 0.04))));
  return mix(c, white, 0.8 * smoothstep(1.0, 0.2, ellipse(d2, vec2(0.02, 0.013))));
}
`;
