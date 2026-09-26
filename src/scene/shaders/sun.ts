// Photosphere shader: limb darkening as a 5th-order polynomial in μ = cos θ,
// I(μ)/I(1) = Σ a_k μ^k, with separate coefficients for R, G, B wavelengths.
// Coefficients are set from Neckel & Labs (1994) via the `limb` uniforms.

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
