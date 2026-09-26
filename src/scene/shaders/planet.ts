// Planet surface shader. Lighting happens in camera-relative world space
// (the camera is at the origin), all in linear HDR.
//
// Shading models:
//  0 lunar-Lambert (McEwen 1991): f = (1-L)·μ0 + 2L·μ0/(μ0+μ). L=1 reproduces
//    the flat, un-limb-darkened full Moon.
//  1 Minnaert: f = μ0^k · μ^(k-1), a standard fit for cloud-covered giants.
//  2 Earth: Lambert day side with night lights past the terminator.
//
// Mosaics that mix close-up and distant imagery (Pluto, Charon, Triton) carry
// a sharpness mask; where it is low the shader adds synthetic craters and
// rolling relief below the source's resolution, so the far side is not a smear.

import { atmosphereChunk } from './atmosphere.ts';
import { ringChunk } from './rings.ts';

export const planetVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vCenterW;
varying vec3 vEastW;
varying vec3 vNorthW;

void main() {
  vUv = uv;
  // Local east and north on the surface, for relief (normal) maps.
  float lon = atan(position.y, position.x);
  vec3 eastB = vec3(-sin(lon), cos(lon), 0.0);
  vec3 northB = cross(normalize(position), eastB);
  vEastW = normalize(mat3(modelMatrix) * eastB);
  vNorthW = normalize(mat3(modelMatrix) * northB);
  vCenterW = modelMatrix[3].xyz;
  vObj = position;
  vec3 s = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
  // Ellipsoid normal: R·(p/s) where p is on the unit sphere.
  vNormalW = normalize(mat3(modelMatrix) * (position / (s * s)));
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

export const planetFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D map;
uniform bool hasMap;
uniform vec3 tint;
uniform sampler2D nightMap;
uniform bool hasNight;
uniform sampler2D map2;       // Earth: next month's imagery
uniform float mapBlend;       // 0 = map, 1 = map2
// Streamed detail tiles (see detailTiles.ts): an array of tile images and an
// index with one texel per tile (r = layer, g = month: 0 map / 1 map2, a = present).
uniform highp sampler2DArray detailTex;
uniform sampler2D detailIndex;
uniform bool hasDetail;
uniform vec2 detailGrid;      // tiles across, down
uniform vec2 detailFrame;     // content fraction, gutter offset (tile units)
uniform sampler2D cloudMap;
uniform bool hasClouds;
uniform float cloudShadow;
uniform float cloudHeight;    // cloud-top height / radius
uniform vec3 sunDirBody;      // unit Sun direction in the body-fixed frame
uniform vec3 sunPos;       // camera-relative position of the Sun's center (m)
uniform float irradiance;  // relative solar irradiance incl. exposure
uniform int model;
uniform float lunarL;
uniform float minnaertK;
uniform float nightGain;
${atmosphereChunk}
${ringChunk}
uniform bool hasRings;
uniform vec3 ringPole;
uniform sampler2D normalMap;  // relief: local (east, north, up) normal, RGB = 0.5 + 0.5·n
uniform bool hasNormalMap;
uniform sampler2D sharpMap;   // 1 = sharp source imagery, 0 = stretched from distant frames
uniform bool hasSharpMap;
uniform float bodyRadiusKm;
uniform float synthCraters;  // crater density in the synthetic relief (1 = Pluto-like)
uniform bool hasGlint;
uniform float glintSlope2;   // Cox-Munk mean square wave slope
// Eclipses: bodies that can block the Sun (camera-relative center, radius in m).
uniform vec4 occluders[4];
uniform float occluderRed[4]; // > 0: sunlight refracted red through its atmosphere
uniform int occluderCount;
uniform float sunRadius;

// Area of overlap of two disks (radii r1, r2, centers d apart), small angles.
float diskOverlap(float r1, float r2, float d) {
  if (d >= r1 + r2) return 0.0;
  if (d <= abs(r1 - r2)) return 3.14159265 * min(r1, r2) * min(r1, r2);
  float a = r1 * r1 * acos(clamp((d * d + r1 * r1 - r2 * r2) / (2.0 * d * r1), -1.0, 1.0));
  float b = r2 * r2 * acos(clamp((d * d + r2 * r2 - r1 * r1) / (2.0 * d * r2), -1.0, 1.0));
  float c = 0.5 * sqrt(max((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2), 0.0));
  return a + b - c;
}

// Fraction of the solar disk visible from p, and the red light bent into
// the umbra by an occluder's atmosphere (as in a lunar eclipse).
vec2 sunVisibility(vec3 p) {
  vec3 S = sunPos - p;
  float dS = length(S);
  float aS = asin(clamp(sunRadius / dS, 0.0, 1.0));
  float vis = 1.0;
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
    float blocked = diskOverlap(aS, aO, sep) / (3.14159265 * aS * aS);
    vis *= 1.0 - clamp(blocked, 0.0, 1.0);
    red = max(red, occluderRed[k] * clamp(blocked, 0.0, 1.0));
  }
  return vec2(vis, red);
}


// ---- synthetic relief for low-resolution regions ----
uint hashU(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
float hash1(ivec3 c) { return float(hashU(uvec3(c))) * (1.0 / 4294967295.0); }
vec3 hash3(ivec3 c) {
  return vec3(hash1(c + ivec3(17, 59, 83)), hash1(c + ivec3(151, 7, 29)), hash1(c + ivec3(43, 211, 97)));
}

// Value noise in [-1, 1] with its analytic gradient (Quilez): (value, d/dx).
vec4 noised(vec3 x) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash1(i), b = hash1(i + ivec3(1, 0, 0)), c = hash1(i + ivec3(0, 1, 0)), d = hash1(i + ivec3(1, 1, 0));
  float e = hash1(i + ivec3(0, 0, 1)), g = hash1(i + ivec3(1, 0, 1)), h = hash1(i + ivec3(0, 1, 1)), k = hash1(i + ivec3(1, 1, 1));
  float k1 = b - a, k2 = c - a, k3 = e - a, k4 = a - b - c + d, k5 = a - c - e + h, k6 = a - b - e + g, k7 = -a + b + c - d + e - g - h + k;
  float v = a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z;
  vec3 dv = du * vec3(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z, k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x, k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y);
  return vec4(2.0 * v - 1.0, 2.0 * dv);
}

// Simple craters (bowl, depth/diameter 0.15, raised rim) scattered one per
// occupied cell of a 3D grid; the sphere slices them into circles.
// Returns (height, gradient) in cell units.
vec4 craters(vec3 x, float occupancy) {
  ivec3 i = ivec3(floor(x));
  vec3 f = fract(x);
  vec4 acc = vec4(0.0);
  for (int dz = -1; dz <= 1; dz++)
  for (int dy = -1; dy <= 1; dy++)
  for (int dx = -1; dx <= 1; dx++) {
    ivec3 o = ivec3(dx, dy, dz);
    ivec3 c = i + o;
    if (hash1(c + ivec3(71, 13, 37)) > occupancy) continue;
    vec3 rnd = hash3(c);
    // Many small, few large.
    float r = mix(0.12, 0.5, rnd.z * rnd.z * rnd.z);
    vec3 dv = f - (vec3(o) + vec3(rnd.xy, fract(rnd.x + rnd.y * 7.0)));
    float dist = length(dv);
    float t = dist / r;
    if (t > 2.0 || dist < 1e-5) continue;
    float depth = 0.3 * r;
    float rimT = t - 1.0;
    float rim = 0.28 * exp(-6.0 * rimT * rimT);
    float hp = (t < 1.0 ? t * t - 1.0 : 0.0) + rim;
    float dhp = (t < 1.0 ? 2.0 * t : 0.0) - 12.0 * rimT * rim;
    acc.x += depth * hp;
    acc.yzw += depth * dhp * dv / (dist * r);
  }
  return acc;
}

// Height (in body radii) gradient and albedo factor to add at unit-sphere
// point p, faded per octave once its features shrink below a few pixels.
// fp: surface footprint of one pixel in body radii. Returns (albedo factor, gradient).
vec4 synthRelief(vec3 p, float fp) {
  vec3 grad = vec3(0.0);
  float alb = 0.0;
  // Rolling terrain from ~40 km down to ~1 km: constant RMS slope per octave.
  float freq = bodyRadiusKm / 40.0;
  for (int o = 0; o < 6; o++) {
    float w = 1.0 - smoothstep(0.2, 0.5, freq * fp);
    if (w <= 0.0) break;
    vec4 n = noised(p * freq + float(o) * 17.31);
    grad += w * 0.09 * n.yzw;
    alb += w * 0.14 * n.x;
    freq *= 2.03;
  }
  // Craters at three scales: cells of ~60, ~18 and ~5 km.
  float cells[3] = float[3](60.0, 18.0, 5.0);
  float occupancy[3] = float[3](0.12, 0.2, 0.3);
  for (int o = 0; o < 3; o++) {
    float cf = bodyRadiusKm / cells[o];
    float w = 1.0 - smoothstep(0.08, 0.2, cf * fp);
    if (w <= 0.0) break;
    // Thin the craters out in patches, so some terrain reads as smoother plains.
    vec4 cr = craters(p * cf + float(o) * 5.7, synthCraters * occupancy[o] * (0.6 + 0.8 * smoothstep(-0.4, 0.4, noised(p * bodyRadiusKm / 150.0).x)));
    grad += w * cr.yzw;
    // Crater floors darker, rims brighter (in cell units: depth up to ~0.15).
    alb += w * 2.5 * cr.x;
  }
  return vec4(clamp(1.0 + alb, 0.6, 1.4), grad);
}

varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vCenterW;
varying vec3 vEastW;
varying vec3 vNorthW;

void main() {
  #include <logdepthbuf_fragment>
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(sunPos - vPosW);
  vec3 V = normalize(-vPosW);
  float mu0 = dot(N, L);
  float mu = max(dot(N, V), 1e-4);
  // Terrain relief: light on the true local slope. Beyond the terminator the
  // geometric factor lets sunward peaks catch the last light.
  float mu0L = mu0;
  float muL = mu;
  vec3 Nr = N;
  bool relief = false;
  if (hasNormalMap) {
    vec3 nt = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    // Fade out at the poles, where the map's east-west spacing collapses.
    float polar = 1.0 - smoothstep(0.985, 0.998, abs(normalize(vObj).z));
    nt = normalize(mix(vec3(0.0, 0.0, 1.0), nt, polar));
    Nr = normalize(normalize(vEastW) * nt.x + normalize(vNorthW) * nt.y + N * nt.z);
    relief = true;
  }
  float synthAlbedo = 1.0;
  if (hasSharpMap) {
    float blurry = smoothstep(0.1, 0.7, 1.0 - texture2D(sharpMap, vUv).r);
    vec3 p = normalize(vObj);
    float fp = length(fwidth(vObj));
    if (blurry > 0.0 && fp < 0.05) {
      vec4 sr = synthRelief(p, fp);
      synthAlbedo = mix(1.0, sr.x, blurry);
      // Tangential part of the height gradient, in the local east/north frame.
      vec3 g = sr.yzw - dot(sr.yzw, p) * p;
      float lon = atan(p.y, p.x);
      vec3 eastB = vec3(-sin(lon), cos(lon), 0.0);
      vec3 northB = cross(p, eastB);
      float polar = 1.0 - smoothstep(0.985, 0.998, abs(p.z));
      Nr = normalize(Nr - blurry * polar * (dot(g, eastB) * normalize(vEastW) + dot(g, northB) * normalize(vNorthW)));
      relief = true;
    }
  }
  if (relief) {
    mu0L = dot(Nr, L) * smoothstep(-0.04, 0.02, mu0);
    muL = max(dot(Nr, V), 1e-4);
  }

  vec3 albA = hasMap ? texture2D(map, vUv).rgb : tint;
  vec3 albB = albA;
  if (hasMap && mapBlend > 0.0) albB = texture2D(map2, vUv).rgb;
  vec3 albedo = mix(albA, albB, mapBlend) * synthAlbedo;
  if (hasDetail) {
    // Tile under this fragment (y counted from the north).
    vec2 tc = vec2(vUv.x, 1.0 - vUv.y) * detailGrid;
    ivec2 ti = clamp(ivec2(floor(tc)), ivec2(0), ivec2(detailGrid) - 1);
    vec4 ind = texelFetch(detailIndex, ti, 0);
    if (ind.a > 0.5) {
      vec2 f = tc - vec2(ti);
      // Tile images are stored south-up (row 0 = south edge), inside a gutter.
      vec2 st = detailFrame.y + vec2(f.x, 1.0 - f.y) * detailFrame.x;
      // Gradients from the continuous global uv, so mip selection ignores tile edges.
      vec2 g = detailGrid * detailFrame.x;
      vec2 gx = dFdx(vUv) * g;
      vec2 gy = dFdy(vUv) * g;
      vec3 d = textureGrad(detailTex, vec3(st, floor(ind.r * 255.0 + 0.5)), gx, gy).rgb;
      // The tile carries one month's fine detail; the seasonal blend between
      // months comes from the global maps (difference of low frequencies).
      vec3 same = ind.g > 0.5 ? albB : albA;
      // Once minified past half resolution the global map is just as sharp.
      vec2 texels = vec2(textureSize(detailTex, 0).xy);
      float lod = 0.5 * log2(max(dot(gx * texels, gx * texels), dot(gy * texels, gy * texels)));
      albedo = mix(albedo, max(d + albedo - same, 0.0), 1.0 - smoothstep(0.5, 1.5, lod));
    }
  }

  float f;
  if (model == 0) {
    float m0 = max(mu0L, 0.0);
    float mu = muL;
    float Lp = lunarL;
    if (Lp < 0.0) {
      // McEwen (1996) L(α), α = phase angle in degrees.
      float a = degrees(acos(clamp(dot(L, V), -1.0, 1.0)));
      Lp = clamp(1.0 - 0.019 * a + 2.42e-4 * a * a - 1.46e-6 * a * a * a, 0.0, 1.0);
    }
    f = (1.0 - Lp) * m0 + 2.0 * Lp * m0 / (m0 + mu);
  } else if (model == 1) {
    float m0 = max(mu0L, 0.0);
    f = pow(m0, minnaertK) * pow(muL, minnaertK - 1.0);
  } else {
    f = max(mu0L, 0.0);
  }

  // Sunlight reaching the ground is reddened by the atmosphere near the terminator.
  vec3 sunT = vec3(1.0);
  float tGround = length(vPosW) * 0.001; // km
  if (hasAtmosphere) {
    vec3 pg = atmCamPos + normalize(vPosW) * tGround;
    sunT = exp(-atmExtinction(atmSunDepth(pg)));
  }

  if (hasRings && mu0 > 0.0) {
    // Shadow of the rings: where the ray toward the Sun crosses the ring plane.
    vec3 center = vCenterW;
    float ln = dot(L, ringPole);
    if (abs(ln) > 1e-4) {
      float t = dot(center - vPosW, ringPole) / ln;
      if (t > 0.0) {
        float rKm = length(vPosW + L * t - center) * 0.001;
        sunT *= exp(-ringTauAt(rKm) / abs(ln));
      }
    }
  }

  vec2 ecl = occluderCount > 0 ? sunVisibility(vPosW) : vec2(1.0, 0.0);
  sunT *= ecl.x;
  vec3 color = albedo * f * irradiance * sunT;
  // In Earth's umbra the Moon is lit only by sunlight refracted red through
  // Earth's atmosphere. Physically that is ~1/10,000 of full-Moon brightness
  // (Danjon L≈2-3); it is shown ~1/10 as bright, as a dark-adapted eye sees it.
  color += albedo * f * irradiance * ecl.y * (1.0 - ecl.x) * vec3(0.25, 0.06, 0.012);

  if (hasGlint && mu0 > 0.0) {
    // Sun glint on open water. The imagery marks water by its deep blue (Blue
    // Marble open ocean is about sRGB 2,5,20: blue ≈ 4.7× green in linear
    // light, while land, ice and cloud stay below 1.2×).
    float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    float blueRatio = albedo.b / max(max(albedo.r, albedo.g), 1e-4);
    float water = smoothstep(1.6, 2.6, blueRatio) * (1.0 - smoothstep(0.1, 0.3, lum));
    // Cox & Munk (1954) Gaussian wave slopes with Fresnel reflection off water,
    // in the same units as the Lambert term above: F·exp(-tan²β/σ²)/(4σ²·μ·cos⁴β).
    vec3 H = normalize(L + V);
    float cb = max(dot(N, H), 1e-3);
    float cb2 = cb * cb;
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(L, H), 0.0), 5.0);
    float spec = F * exp(-(1.0 - cb2) / (cb2 * glintSlope2)) / (4.0 * glintSlope2 * max(mu, 0.05) * cb2 * cb2);
    color += water * spec * irradiance * sunT;
  }

  if (hasClouds) {
    float c = texture2D(cloudMap, vUv).r;
    // Cloud shadows: a ground point is shaded by the cloud a horizontal distance
    // h·tan(zenith) toward the Sun, with h the cloud height over the body radius.
    vec3 p = normalize(vObj);
    float lon = atan(p.y, p.x);
    float cl = max(length(p.xy), 1e-3);
    vec3 east = vec3(-sin(lon), cos(lon), 0.0);
    vec3 north = cross(p, east);
    float up = max(dot(sunDirBody, p), 0.08);
    vec2 horiz = vec2(dot(sunDirBody, east), dot(sunDirBody, north)) / up;
    vec2 duv = horiz * cloudHeight / vec2(6.2831853 * cl, 3.1415927);
    float shade = texture2D(cloudMap, vUv + duv).r;
    color *= 1.0 - cloudShadow * shade * step(0.0, mu0);
    vec3 cloudLit = vec3(0.95) * max(mu0, 0.0) * irradiance * sunT;
    color = mix(color, cloudLit, c);
  }

  if (hasNight) {
    // City lights fade in as the Sun drops below the horizon (civil twilight ~ -6 deg).
    float dark = smoothstep(0.05, -0.12, mu0);
    vec3 lights = texture2D(nightMap, vUv).rgb;
    color += lights * lights * dark * nightGain;
  }

  if (hasAtmosphere) {
    vec3 inscatter, transmit;
    atmScatter(atmCamPos, normalize(vPosW), tGround, irradiance, inscatter, transmit);
    // The air inside the Moon's shadow is unlit too.
    color = color * transmit + inscatter * ecl.x;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
