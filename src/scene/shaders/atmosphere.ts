// Single-scattering atmosphere (Rayleigh + Mie), ray-marched per fragment.
// Units are kilometers in a planet-centered frame with world (EQJ) axes, so
// float32 stays precise. Radiance is in the same units as the planet shader,
// where `irradiance` = E_sun / π; a Lambertian white surface at normal
// incidence has radiance `irradiance`. In-scattered radiance is therefore
//   L = π · irradiance · Σ β·P(θ)·T·ds,  with phase functions normalized over 4π.
//
// References: Nishita et al. 1993; Bruneton & Neyret 2008 (coefficients).
//
// Sunlight at each sample is dimmed by eclipses (a moon's shadow on the air),
// so eclipseChunk must be included before atmosphereChunk.

import { eclipseChunk } from './eclipse.ts';

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
// Stretches the polar axis so an oblate planet becomes a sphere of radius atmRp
// (identity for round bodies). Rays are traced in that frame and path lengths
// converted back to km, so the shell follows the equatorial bulge.
uniform mat3 atmShape;
uniform float atmMS;         // approximate multiple scattering (0 = single scattering only)

vec2 atmRaySphere(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e9, -1e9);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

// Optical depth (Rayleigh, Mie) from p toward the Sun to the top of the
// atmosphere, in the spherified frame: s is the unit sun direction there and
// k its length per km.
vec2 atmSunDepthS(vec3 p, vec3 s, float k) {
  vec2 hit = atmRaySphere(p, s, atmRa);
  float len = max(hit.y, 0.0);
  const int M = 6;
  float ds = len / float(M);
  vec2 od = vec2(0.0);
  for (int j = 0; j < M; j++) {
    vec3 q = p + s * ds * (float(j) + 0.5);
    float h = max(length(q) - atmRp, 0.0);
    od += vec2(exp(-h / atmHR), exp(-h / atmHM)) * ds;
  }
  return od / k;
}

// The same from a planet-centered point p (km).
vec2 atmSunDepth(vec3 p) {
  vec3 s = atmShape * atmSunDir;
  float k = length(s);
  return atmSunDepthS(atmShape * p, s / k, k);
}

vec3 atmExtinction(vec2 od) {
  return atmBetaR * od.x + atmBetaM * atmMieExt * od.y + atmAbsorb * od.x;
}

// In-scattering and transmittance along o + d·t for t in [0, tMax].
void atmScatter(vec3 o, vec3 d, float tMax, float irr, out vec3 inscatter, out vec3 transmit) {
  inscatter = vec3(0.0);
  transmit = vec3(1.0);
  // Trace in the spherified frame; k is its length per km along the ray.
  vec3 oS = atmShape * o;
  vec3 dS = atmShape * d;
  float k = length(dS);
  dS /= k;
  vec3 sS = atmShape * atmSunDir;
  float kS = length(sS);
  sS /= kS;
  vec2 hit = atmRaySphere(oS, dS, atmRa);
  float t0 = max(hit.x, 0.0);
  float t1 = min(hit.y, tMax * k);
  if (t1 <= t0) return;
  const int N = 16;
  float ds = (t1 - t0) / float(N);
  // Samples in camera-relative meters, for the eclipse test, which is skipped
  // when no occluder's penumbra comes near this stretch of the ray.
  vec3 oW = (o - atmCamPos) * 1000.0;
  float mPerT = 1000.0 / k;
  bool eclipsed = occluderCount > 0 && eclipseTouches(oW + d * (t0 * mPerT), oW + d * (t1 * mPerT));
  vec2 odView = vec2(0.0);
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  vec3 sumMS = vec3(0.0);
  for (int i = 0; i < N; i++) {
    float t = t0 + ds * (float(i) + 0.5);
    vec3 p = oS + dS * t;
    float h = max(length(p) - atmRp, 0.0);
    vec2 dens = vec2(exp(-h / atmHR), exp(-h / atmHM)) * (ds / k);
    odView += dens;
    // Planet shadow on the sun ray.
    vec2 ph = atmRaySphere(p, sS, atmRp);
    if (ph.x > 0.0) continue;
    // Eclipse shadow on the sun ray (a moon's umbra leaves the air unlit).
    vec3 sun = eclipsed ? sunVisibility(oW + d * (t * mPerT)).rgb : vec3(1.0);
    if (max(sun.r, max(sun.g, sun.b)) <= 0.0) continue;
    vec3 Tv = exp(-atmExtinction(odView));
    vec3 Ts = exp(-atmExtinction(atmSunDepthS(p, sS, kS))) * sun;
    sumR += dens.x * Tv * Ts;
    sumM += dens.y * Tv * Ts;
    // Sunlight the haze removed on the way in, rescattered (isotropically) as
    // diffuse light: fills the dark base single scattering leaves in an opaque limb.
    sumMS += (atmBetaR * dens.x + atmBetaM * atmMieTint * dens.y) * Tv * (sun - Ts);
  }
  float mu = dot(d, atmSunDir);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g2 = atmG * atmG;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * atmG * mu, 1.5));
  inscatter = PI * irr * (sumR * atmBetaR * phaseR + sumM * atmBetaM * atmMieTint * phaseM + sumMS * atmMS / (4.0 * PI));
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
${eclipseChunk}
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
  /**
   * Approximate multiple scattering, as a fraction of the sunlight the
   * atmosphere removes that comes back out as diffuse light. For optically
   * thick hazes; 0 (default) is single scattering only.
   */
  multiScatter?: number;
  /** Bends reddened sunlight into its shadow, lighting moons in eclipse (as Earth does the Moon). */
  redUmbra?: boolean;
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
  redUmbra: true,
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
  redUmbra: true,
  source: 'Lemmon et al. 2015 (dust optical depth); Wolff et al. 2009 (dust scattering properties)',
};

// The bodies below only get the limb shell (surface: false): their disks are
// cloud decks or haze whose imagery and colors already include the scattering.
// Rayleigh β is Earth's (above) scaled by number density at the reference level
// and by molecular polarizability squared (per molecule, relative to air:
// H₂ 0.21, He 0.015, CH₄ 2.3, CO₂ 2.5). Scale heights from the NSSDCA fact
// sheets. Haze amounts are representative values, not fits to observations.

/** Scales Earth's sea-level Rayleigh β by relative number density × cross-section. */
const rayleigh = (k: number): [number, number, number] => [5.802e-3 * k, 13.558e-3 * k, 33.1e-3 * k];

/**
 * Venus: above the cloud tops (~70 km, ~35 mbar, 230 K; the disk is drawn at
 * the solid radius) CO₂ with a 5 km scale height and a thin sulfuric-acid
 * upper haze (optical depth ~0.2, nearly conservative).
 */
export const VENUS_ATMOSPHERE: AtmosphereParams = {
  top: 50,
  betaR: rayleigh(0.043 * 2.5),
  betaM: 0.2 / 5,
  mieTint: [1, 1, 0.97],
  mieExt: [1, 1, 1],
  HR: 5,
  HM: 5,
  g: 0.7,
  absorb: [0, 0, 0],
  surface: false,
  multiScatter: 1,
  source: 'Approximate: CO₂ above the cloud tops with a thin upper haze (representative optical depth 0.2)',
};

/**
 * Jupiter: from the 1-bar level (165 K; 86% H₂, 14% He), scale height 27 km,
 * with a yellowish haze of optical depth ~0.5 that absorbs some blue.
 */
export const JUPITER_ATMOSPHERE: AtmosphereParams = {
  top: 300,
  betaR: rayleigh(1.72 * 0.187),
  betaM: 0.5 / 27,
  mieTint: [0.98, 0.94, 0.82],
  mieExt: [1, 1, 1],
  HR: 27,
  HM: 27,
  g: 0.65,
  absorb: [0, 0, 0],
  surface: false,
  multiScatter: 1,
  source: 'Approximate: H₂/He Rayleigh from the 1-bar level (NSSDCA scale height 27 km) with a representative haze',
};

/**
 * Saturn: from the 1-bar level (134 K; 96% H₂), scale height 59.5 km, under
 * the thick yellowish haze that mutes its bands (optical depth ~1).
 */
export const SATURN_ATMOSPHERE: AtmosphereParams = {
  top: 600,
  betaR: rayleigh(2.12 * 0.207),
  betaM: 1 / 59.5,
  mieTint: [0.98, 0.95, 0.85],
  mieExt: [1, 1, 1],
  HR: 59.5,
  HM: 59.5,
  g: 0.65,
  absorb: [0, 0, 0],
  surface: false,
  multiScatter: 1,
  source: 'Approximate: H₂/He Rayleigh from the 1-bar level (NSSDCA scale height 59.5 km) with a representative haze',
};

/** Uranus: from the 1-bar level (76 K; 83% H₂, 15% He, 2.3% CH₄), scale height 27.7 km, thin haze. */
export const URANUS_ATMOSPHERE: AtmosphereParams = {
  top: 250,
  betaR: rayleigh(3.74 * 0.232),
  betaM: 0.3 / 27.7,
  mieTint: [1, 1, 1],
  mieExt: [1, 1, 1],
  HR: 27.7,
  HM: 27.7,
  g: 0.6,
  absorb: [0, 0, 0],
  surface: false,
  multiScatter: 1,
  source: 'Approximate: H₂/He/CH₄ Rayleigh from the 1-bar level (NSSDCA scale height 27.7 km) with a thin representative haze',
};

/** Neptune: from the 1-bar level (72 K; 80% H₂, 19% He, 1.5% CH₄), scale height ~20 km, thin haze. */
export const NEPTUNE_ATMOSPHERE: AtmosphereParams = {
  top: 200,
  betaR: rayleigh(3.95 * 0.209),
  betaM: 0.2 / 19.7,
  mieTint: [1, 1, 1],
  mieExt: [1, 1, 1],
  HR: 19.7,
  HM: 19.7,
  g: 0.6,
  absorb: [0, 0, 0],
  surface: false,
  multiScatter: 1,
  source: 'Approximate: H₂/He/CH₄ Rayleigh from the 1-bar level (NSSDCA scale height 19.1–20.3 km) with a thin representative haze',
};

/**
 * Titan: an orange photochemical haze that hides the surface, with an
 * extinction scale height ~60 km and visible optical depth ~4 overall, so it
 * stays opaque at the limb to ~250 km. Scattering albedo falls toward the
 * blue (the orange color); N₂ Rayleigh from the 1.5-bar, 94 K surface.
 */
export const TITAN_ATMOSPHERE: AtmosphereParams = {
  top: 600,
  betaR: rayleigh(4.54),
  betaM: 4 / 60,
  mieTint: [0.95, 0.8, 0.5],
  mieExt: [1, 1, 1],
  HR: 20.6,
  HM: 60,
  g: 0.6,
  absorb: [0, 0, 0],
  surface: false,
  multiScatter: 1,
  source: 'Approximate haze profile in line with Huygens DISR measurements (Tomasko et al. 2008)',
};
