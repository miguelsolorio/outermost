// Planet surface shader. Lighting happens in camera-relative world space
// (the camera is at the origin), all in linear HDR.
//
// Shading models:
//  0 lunar-Lambert (McEwen 1991): f = (1-L)·μ0 + 2L·μ0/(μ0+μ). L=1 reproduces
//    the flat, un-limb-darkened full Moon.
//  1 Minnaert: f = μ0^k · μ^(k-1), a standard fit for cloud-covered giants.
//  2 Earth: Lambert day side with night lights past the terminator.

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
  if (hasNormalMap) {
    vec3 nt = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    // Fade out at the poles, where the map's east-west spacing collapses.
    float polar = 1.0 - smoothstep(0.985, 0.998, abs(normalize(vObj).z));
    nt = normalize(mix(vec3(0.0, 0.0, 1.0), nt, polar));
    vec3 Nr = normalize(normalize(vEastW) * nt.x + normalize(vNorthW) * nt.y + N * nt.z);
    mu0L = dot(Nr, L) * smoothstep(-0.04, 0.02, mu0);
    muL = max(dot(Nr, V), 1e-4);
  }

  vec3 albA = hasMap ? texture2D(map, vUv).rgb : tint;
  vec3 albB = albA;
  if (hasMap && mapBlend > 0.0) albB = texture2D(map2, vUv).rgb;
  vec3 albedo = mix(albA, albB, mapBlend);
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
