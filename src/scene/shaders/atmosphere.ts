// Single-scattering atmosphere (Rayleigh + Mie), ray-marched per fragment.
// Units are kilometers in a planet-centered frame with world (EQJ) axes, so
// float32 stays precise. Radiance is in the same units as the planet shader,
// where `irradiance` = E_sun / π; a Lambertian white surface at normal
// incidence has radiance `irradiance`. In-scattered radiance is therefore
//   L = π · irradiance · Σ β·P(θ)·T·ds,  with phase functions normalized over 4π.
//
// References: Nishita et al. 1993; Bruneton & Neyret 2008 (coefficients).

export const atmosphereChunk = /* glsl */ `
uniform bool hasAtmosphere;
uniform vec3 atmCamPos;      // camera position relative to planet center (km)
uniform vec3 atmSunDir;      // unit direction to the Sun (world axes)
uniform float atmRp;         // planet radius (km)
uniform float atmRa;         // top of atmosphere (km)
uniform vec3 atmBetaR;       // Rayleigh scattering (1/km)
uniform float atmBetaM;      // Mie scattering (1/km)
uniform vec3 atmMieTint;     // Mie single-scattering albedo per channel (Mars dust absorbs blue)
uniform vec3 atmMieExt;      // Mie extinction per unit scattering coefficient
uniform float atmHR;         // Rayleigh scale height (km)
uniform float atmHM;         // Mie scale height (km)
uniform float atmG;          // Mie asymmetry
uniform vec3 atmAbsorb;      // extra absorption (ozone), 1/km at peak

vec2 atmRaySphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e9, -1e9);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

// Optical depth (Rayleigh, Mie) from p toward the Sun to the top of the atmosphere.
vec2 atmSunDepth(vec3 p) {
  vec2 hit = atmRaySphere(p, atmSunDir, atmRa);
  float len = max(hit.y, 0.0);
  const int M = 6;
  float ds = len / float(M);
  vec2 od = vec2(0.0);
  for (int j = 0; j < M; j++) {
    vec3 q = p + atmSunDir * ds * (float(j) + 0.5);
    float h = max(length(q) - atmRp, 0.0);
    od += vec2(exp(-h / atmHR), exp(-h / atmHM)) * ds;
  }
  return od;
}

vec3 atmExtinction(vec2 od) {
  return atmBetaR * od.x + atmBetaM * atmMieExt * od.y + atmAbsorb * od.x;
}

// In-scattering and transmittance along o + d·t for t in [0, tMax].
void atmScatter(vec3 o, vec3 d, float tMax, float irr, out vec3 inscatter, out vec3 transmit) {
  inscatter = vec3(0.0);
  transmit = vec3(1.0);
  vec2 hit = atmRaySphere(o, d, atmRa);
  float t0 = max(hit.x, 0.0);
  float t1 = min(hit.y, tMax);
  if (t1 <= t0) return;
  const int N = 16;
  float ds = (t1 - t0) / float(N);
  vec2 odView = vec2(0.0);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 p = o + d * (t0 + ds * (float(i) + 0.5));
    float h = max(length(p) - atmRp, 0.0);
    vec2 dens = vec2(exp(-h / atmHR), exp(-h / atmHM)) * ds;
    odView += dens;
    // Planet shadow on the sun ray.
    vec2 ph = atmRaySphere(p, atmSunDir, atmRp);
    if (ph.x > 0.0) continue;
    vec3 T = exp(-atmExtinction(odView + atmSunDepth(p)));
    sumR += dens.x * T;
    sumM += dens.y * T;
  }
  float mu = dot(d, atmSunDir);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = atmG * atmG;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * atmG * mu, 1.5));
  inscatter = PI * irr * (sumR * atmBetaR * phaseR + sumM * atmBetaM * atmMieTint * phaseM);
  transmit = exp(-atmExtinction(odView));
}
`;

export const atmosphereVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vPosW;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

export const atmosphereFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float irradiance;
${atmosphereChunk}
varying vec3 vPosW;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(vPosW);
  vec3 inscatter, transmit;
  atmScatter(atmCamPos, d, 1e9, irradiance, inscatter, transmit);
  gl_FragColor = vec4(inscatter, 1.0);
}
`;

export interface AtmosphereParams {
  /** Height of the shell top above the surface (km). */
  top: number;
  /** Rayleigh scattering at the surface (1/km) at 680/550/440 nm. */
  betaR: [number, number, number];
  /** Aerosol extinction scale at the surface (1/km). */
  betaM: number;
  /** Aerosol scattering per channel, as a fraction of betaM (single-scattering albedo). */
  mieTint: [number, number, number];
  /** Aerosol extinction per channel, as a multiple of betaM. */
  mieExt: [number, number, number];
  HR: number;
  HM: number;
  g: number;
  absorb: [number, number, number];
  /**
   * Apply the atmosphere to the surface too (default). False when the surface
   * imagery was taken through the atmosphere and not corrected for it, so only
   * the limb shell is drawn.
   */
  surface?: boolean;
  source: string;
}

/**
 * Earth: Rayleigh β at 680/550/440 nm and scale heights from Bruneton & Neyret
 * (2008); Mie scattering from Bruneton's 2017 reference implementation (rural
 * aerosol, g = 0.8); ozone absorption peak from the same.
 */
export const EARTH_ATMOSPHERE: AtmosphereParams = {
  top: 100,
  betaR: [5.802e-3, 13.558e-3, 33.1e-3],
  betaM: 3.996e-3,
  mieTint: [1, 1, 1],
  // Extinction = scattering / single-scattering albedo 0.9.
  mieExt: [1.11, 1.11, 1.11],
  HR: 8,
  HM: 1.2,
  g: 0.8,
  // Ozone (Bruneton 2017: 0.650, 1.881, 0.085 × 1e-3 /km in a 30 km tent profile).
  // Carried on the Rayleigh density here, scaled 15/8 so the zenith column matches.
  absorb: [0.65e-3 * 1.875, 1.881e-3 * 1.875, 0.085e-3 * 1.875],
  source: 'Bruneton & Neyret 2008; Bruneton 2017 precomputed atmospheric scattering',
};

/**
 * Mars: thin CO₂ (6.1 mbar, 210 K) with suspended dust.
 *  - Rayleigh: CO₂ scatters ~2.5× air per molecule at 0.8% of Earth's
 *    surface number density, so ~2% of Earth's β; scale height 11.1 km.
 *  - Dust: typical visible optical depth τ ≈ 0.5 with an 11 km scale height
 *    (Lemmon et al. 2015), grey extinction, single-scattering albedo
 *    ~0.97/0.92/0.78 at 670/550/440 nm and asymmetry g ≈ 0.63 (Wolff et al. 2009).
 */
export const MARS_ATMOSPHERE: AtmosphereParams = {
  top: 80,
  betaR: [1.2e-4, 2.8e-4, 6.9e-4],
  betaM: 0.5 / 11,
  mieTint: [0.97, 0.92, 0.78],
  mieExt: [1, 1, 1],
  HR: 11.1,
  HM: 11,
  g: 0.63,
  absorb: [0, 0, 0],
  // The Viking color mosaic already shows the surface through the dust.
  surface: false,
  source: 'Lemmon et al. 2015 (dust optical depth); Wolff et al. 2009 (dust scattering properties)',
};
