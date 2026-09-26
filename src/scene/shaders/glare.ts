// Screen-facing glare around a star, drawn on a camera-facing quad at the
// star's center. It is depth-tested there, so the star's own disk (and
// anything passing in front) hides it. Far away it is the wide scattering
// halo an eye or camera sees around a dazzling point; as the disk resolves
// (close → 1) it tightens into a soft glow spilling off the limb.

import * as THREE from 'three';

export const glareVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

export const glareFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 color;
uniform float intensity;
uniform float core;  // disk radius as a fraction of the quad
uniform float close; // 0 = distant glare, 1 = resolved disk
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  float r = length(vUv);
  if (r > 1.0) discard;
  float x = max(r - core, 0.0) / (1.0 - core);
  // Two-component halo: a tight bright core falloff plus a wide faint wing.
  float far = exp(-x * x * 60.0) * 0.8 + exp(-x * 7.0) * 0.18 + (1.0 - x) * 0.02;
  // Up close: a limb glow (s = 2 at the quad edge, about two disk radii
  // for mid-sized disks): a bright band, a soft halo and a faint wing.
  float s = 2.0 * x;
  float near = exp(-s * 8.0) * 0.42 + exp(-s * 2.4) * 0.46 + exp(-s * 1.2) * 0.12;
  near *= 1.0 - smoothstep(0.8, 1.0, r);
  gl_FragColor = vec4(color * mix(far, near, close) * intensity, 1.0);
}
`;

export function createGlare(): { mesh: THREE.Mesh; material: THREE.ShaderMaterial } {
  const material = new THREE.ShaderMaterial({
    vertexShader: glareVertex,
    fragmentShader: glareFragment,
    uniforms: {
      color: { value: new THREE.Color(1, 1, 1) },
      intensity: { value: 1 },
      core: { value: 0.1 },
      close: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  return { mesh, material };
}

/**
 * Sizes the glare for a disk of `radius` at distance `d` (angular radius
 * `ang`) and sets its `core` and `close` uniforms. `minFarAng` is the
 * smallest halo while the star is still point-like. Returns `close`.
 */
export function layoutGlare(mesh: THREE.Mesh, material: THREE.ShaderMaterial, radius: number, d: number, ang: number, minFarAng: number): number {
  const close = THREE.MathUtils.smoothstep(ang, 0.01, 0.12);
  // Sizes in tan space (on the quad plane, divided by d) so the glow starts
  // exactly at the silhouette even when the disk is wide.
  const diskTan = radius / Math.sqrt(Math.max(d * d - radius * radius, 1));
  const farTan = Math.tan(Math.max(ang * 6, minFarAng));
  // Up close the glow reaches two disk radii past the limb, but no more than
  // ~20° so a star filling the view doesn't fog the whole sky.
  const quadTan = THREE.MathUtils.lerp(farTan, diskTan + Math.min(diskTan * 2, 0.35), close);
  mesh.scale.setScalar(quadTan * d);
  material.uniforms.core.value = Math.min(0.9, diskTan / quadTan);
  material.uniforms.close.value = close;
  return close;
}
