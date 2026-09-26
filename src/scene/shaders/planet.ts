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
//
// Planets also get an enhanced look (color grade, animated atmospheres; see
// look.ts and scene/looks.ts). Moons keep the identity defaults.

import { atmosphereChunk } from './atmosphere.ts';
import { eclipseChunk } from './eclipse.ts';
import { lookChunk } from './look.ts';
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
uniform float irradiance;  // relative solar irradiance incl. exposure
uniform int model;
uniform float lunarL;
uniform float minnaertK;
uniform float nightGain;
${eclipseChunk}
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
${lookChunk}

// The base map, with local contrast raised against a blurred read of itself
// (brightness only, so the colors don't fringe).
vec3 mapAt(vec2 uv) {
  vec3 c = texture2D(map, uv).rgb;
  if (gradeSharp > 0.0) {
    vec3 d = c - texture2D(map, uv, 2.5).rgb;
    c = max(c + gradeSharp * dot(d, vec3(0.2126, 0.7152, 0.0722)), 0.0);
  }
  return c;
}

// Cloud cover, carried along by the two flow copies when Earth's clouds move.
float cloudAt(vec2 uv, vec2 flowA, vec2 flowB, float w) {
  if (atmo != 2) return texture2D(cloudMap, uv).r;
  return mix(texture2D(cloudMap, uv + flowA).r, texture2D(cloudMap, uv + flowB).r, w);
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

  // Winds (see look.ts). The surface itself never moves: only Jupiter's and
  // Saturn's maps, Earth's clouds and the procedural atmospheres do.
  vec3 bodyDir = normalize(vObj);
  float lat = asin(clamp(bodyDir.z, -1.0, 1.0));
  float fpB = length(fwidth(vObj));
  vec3 fl = atmo > 0 ? flowPhases(lat, 1.0) : vec3(0.0);
  vec2 sw = (atmo == 1 || atmo == 2) ? swirlUv(bodyDir, lat, fpB) : vec2(0.0);
  vec2 flowA = vec2(fl.x / PI2, 0.0) + sw;
  vec2 flowB = vec2(fl.y / PI2, 0.0) + sw;

  vec3 albA;
  if (atmo == 1 && hasMap) albA = mix(mapAt(vUv + flowA), mapAt(vUv + flowB), fl.z);
  else if (atmo == 3) albA = venusAlbedo(bodyDir, lat, fl, fpB);
  else if (atmo == 4) albA = uranusAlbedo(bodyDir, lat, fl, fpB);
  else if (atmo == 5) albA = neptuneAlbedo(bodyDir, lat, fl, fpB);
  else albA = hasMap ? mapAt(vUv) : tint;
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
  // The water mask for sun glint reads the imagery's own colors.
  vec3 albedoTrue = albedo;
  albedo = gradeColor(albedo);
  // Toward the poles, blend to poleTint at the same brightness.
  float lumA = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
  vec3 cool = poleTint.rgb * lumA / max(dot(poleTint.rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  albedo = mix(albedo, cool, poleTint.a * smoothstep(0.55, 0.95, abs(bodyDir.z)));

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

  // Eclipses: the limb-darkened Sun, partly hidden; its last light is redder.
  vec4 ecl = occluderCount > 0 ? sunVisibility(vPosW) : vec4(1.0, 1.0, 1.0, 0.0);
  sunT *= ecl.rgb;
  vec3 color = albedo * f * irradiance * sunT;
  // In Earth's umbra the Moon is lit only by sunlight refracted red through
  // Earth's atmosphere. Physically that is ~1/10,000 of full-Moon brightness
  // (Danjon L≈2-3); it is shown ~1/10 as bright, as a dark-adapted eye sees it.
  color += albedo * f * irradiance * ecl.a * (1.0 - ecl.g) * vec3(0.25, 0.06, 0.012);

  if (hasGlint && mu0 > 0.0) {
    // Sun glint on open water. The imagery marks water by its deep blue (Blue
    // Marble open ocean is about sRGB 2,5,20: blue ≈ 4.7× green in linear
    // light, while land, ice and cloud stay below 1.2×).
    float lum = dot(albedoTrue, vec3(0.2126, 0.7152, 0.0722));
    float blueRatio = albedoTrue.b / max(max(albedoTrue.r, albedoTrue.g), 1e-4);
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
    float c = cloudAt(vUv, flowA, flowB, fl.z);
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
    float shade = cloudAt(vUv + duv, flowA, flowB, fl.z);
    color *= 1.0 - cloudShadow * shade * step(0.0, mu0);
    vec3 cloudLit = vec3(0.95) * max(mu0, 0.0) * irradiance * sunT;
    color = mix(color, cloudLit, c);
  }

  if (hasNight) {
    // City lights fade in as the Sun drops below the horizon (civil twilight ~ -6 deg).
    float dark = 1.0 - smoothstep(-0.12, 0.05, mu0);
    // In the Moon's umbra, streetlights on photocells switch on (near 10 lux,
    // ANSI C136.10). Clear-sky light is ~1.2e5·μ0 lux direct plus ~700 lux of
    // skylight at sunset, both scaled by the Sun left visible. Streetlights are
    // ~13% of Tucson's light seen from orbit (Kyba et al. 2021); with other
    // photocell-controlled lighting, about 30% comes on.
    float lux = (1.2e5 * max(mu0, 0.0) + 700.0) * ecl.g;
    dark = max(dark, 0.3 * (1.0 - smoothstep(10.0, 50.0, lux)));
    vec3 lights = texture2D(nightMap, vUv).rgb;
    color += lights * lights * dark * nightGain;
  }

  if (hasAtmosphere) {
    vec3 inscatter, transmit;
    atmScatter(atmCamPos, normalize(vPosW), tGround, irradiance, inscatter, transmit);
    color = color * transmit + inscatter;
  }

  gl_FragColor = vec4(agxVivid(color, gradeVivid), 1.0);
}
`;
