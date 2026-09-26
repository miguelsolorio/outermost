// Shared unit-sphere geometry in body-fixed coordinates: +Z is the north pole,
// +X the prime meridian, longitude increases east (right-handed).
// UVs match our normalized equirectangular textures: u = (lon + 180°) / 360°
// (0° longitude at the image center, east to the right) and
// v = (lat + 90°) / 180° (south at v = 0).

import * as THREE from 'three';

export function createBodySphere(lonSegments = 256, latSegments = 128): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let j = 0; j <= latSegments; j++) {
    const v = j / latSegments;
    const lat = (v - 0.5) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    for (let i = 0; i <= lonSegments; i++) {
      const u = i / lonSegments;
      const lon = (u - 0.5) * 2 * Math.PI;
      positions.push(cl * Math.cos(lon), cl * Math.sin(lon), sl);
      uvs.push(u, v);
    }
  }
  const row = lonSegments + 1;
  for (let j = 0; j < latSegments; j++) {
    for (let i = 0; i < lonSegments; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      // Counter-clockwise when viewed from outside.
      if (j !== 0) indices.push(a, b, c);
      if (j !== latSegments - 1) indices.push(b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}
