// Saturn's rings as a single-scattering slab with measured normal optical
// depth τ(r) (Voyager PPS). For viewer cosine μ and Sun cosine μ0 relative to
// the ring normal (Chandrasekhar; see e.g. Cuzzi et al. 1984):
//   lit face:   I = ϖ·P/4 · μ0/(μ0+μ) · (1 - exp(-τ(1/μ0 + 1/μ)))
//   unlit face: I = ϖ·P/4 · μ0/(μ0-μ) · (exp(-τ/μ0) - exp(-τ/μ))
// and the background is attenuated by exp(-τ/μ). The planet's shadow falls on
// the rings; the rings' shadow falls on the planet (in the planet shader).
// Radiance units match the planet shader: irradiance = E/π.

export const ringChunk = /* glsl */ `
uniform sampler2D ringTau;
uniform float ringR0;      // km at texture u = 0
uniform float ringR1;      // km at texture u = 1
uniform float ringInner;   // km
uniform float ringOuter;   // km
uniform float ringScale;   // "boost sizes" multiplier

float ringTauAt(float rKmScaled) {
  float rKm = rKmScaled / ringScale;
  if (rKm < ringInner || rKm > ringOuter) return 0.0;
  return texture2D(ringTau, vec2((rKm - ringR0) / (ringR1 - ringR0), 0.5)).r;
}
`;

export const ringVertex = /* glsl */ `
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

export const ringFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ringChunk}
uniform vec3 planetPos;     // camera-relative planet center (m)
uniform vec3 pole;          // ring-plane normal (world)
uniform vec3 sunPos;        // camera-relative Sun (m)
uniform float irradiance;
uniform float planetA;      // equatorial radius (m)
uniform float planetC;      // polar radius (m)
varying vec3 vPosW;

// Particle albedo × color, varying by region (C ring and Cassini Division are
// darker and less red than the A and B rings). Approximate model values.
vec3 ringColor(float r) {
  vec3 dark = vec3(0.21, 0.195, 0.18);
  vec3 bright = vec3(0.56, 0.49, 0.40);
  float b = smoothstep(91500.0, 92500.0, r) * (1.0 - smoothstep(117300.0, 117800.0, r));
  float a = smoothstep(121900.0, 122300.0, r);
  return mix(dark, bright, clamp(a + b, 0.0, 1.0));
}

bool hitsPlanet(vec3 o, vec3 d) {
  // Oblate spheroid: scale the polar component to make it a sphere of radius a.
  float k = planetA / planetC;
  vec3 oc = o - planetPos;
  vec3 oz = pole * dot(oc, pole);
  vec3 dz = pole * dot(d, pole);
  vec3 o2 = (oc - oz) + oz * k;
  vec3 d2 = (d - dz) + dz * k;
  float a = dot(d2, d2);
  float b = dot(o2, d2);
  float c = dot(o2, o2) - planetA * planetA;
  float disc = b * b - a * c;
  if (disc < 0.0) return false;
  float t = (-b - sqrt(disc)) / a;
  return t > 0.0;
}

float slabI(float tau, float mu, float mu0, bool lit) {
  if (lit) return mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu0 + 1.0 / mu)));
  float dm = mu0 - mu;
  return abs(dm) < 1e-3 ? tau / mu * exp(-tau / mu) : mu0 / dm * (exp(-tau / mu0) - exp(-tau / mu));
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 rel = vPosW - planetPos;
  float rS = length(rel) * 0.001;
  vec3 V = normalize(-vPosW);
  vec3 L = normalize(sunPos - vPosW);
  float vn = dot(V, pole);
  float ln = dot(L, pole);
  float mu = max(abs(vn), 0.02);
  float mu0 = max(abs(ln), 0.02);
  bool lit = vn * ln > 0.0;
  float shadow = hitsPlanet(vPosW, L) ? 0.0 : 1.0;
  // Ring particles back-scatter: brightest at low phase angle (P = 1 at zero phase).
  float P = 0.67 + 0.33 * dot(L, V);

  // Box-filter the 10 km profile over this pixel's radial footprint.
  float dr = max(fwidth(rS), 1e-3);
  const int TAPS = 8;
  vec3 sumC = vec3(0.0);
  float sumA = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float rr = rS + dr * ((float(i) + 0.5) / float(TAPS) - 0.5);
    float tau = ringTauAt(rr);
    sumC += ringColor(rr / ringScale) * slabI(tau, mu, mu0, lit);
    sumA += 1.0 - exp(-tau / mu);
  }
  float alpha = sumA / float(TAPS);
  if (alpha < 0.0005) discard;
  // Normalized like the planet shader: a thick ring at low phase has
  // I/F = albedo·2μ0/(μ0+μ), matching a Lommel-Seeliger surface.
  vec3 color = 2.0 * P * (sumC / float(TAPS)) * irradiance * shadow;
  gl_FragColor = vec4(color, alpha);
}
`;
