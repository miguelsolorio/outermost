// Procedural noise for GLSL ES 3.0 shaders, read from a small tiling 3D
// texture of random values: one filtered texture read per octave instead of
// eight hashes. Paste into a shader with ${noiseChunk} and bind
// `noiseTexture()` to its `noiseTex` uniform.

import * as THREE from 'three';

const SIZE = 64;
let shared: THREE.Data3DTexture | null = null;

/** 64³ random values (seeded, so every load looks the same), repeating. */
export function noiseTexture(): THREE.Data3DTexture {
  if (shared) return shared;
  const data = new Uint8Array(SIZE * SIZE * SIZE);
  let s = 0x2545f491;
  for (let i = 0; i < data.length; i++) {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = s & 0xff;
  }
  shared = new THREE.Data3DTexture(data, SIZE, SIZE, SIZE);
  shared.format = THREE.RedFormat;
  shared.type = THREE.UnsignedByteType;
  shared.minFilter = THREE.LinearFilter;
  shared.magFilter = THREE.LinearFilter;
  shared.wrapS = shared.wrapT = shared.wrapR = THREE.RepeatWrapping;
  shared.unpackAlignment = 1;
  shared.needsUpdate = true;
  return shared;
}

export const noiseChunk = /* glsl */ `
uniform sampler3D noiseTex;

// Value noise in [-1, 1]. Remapping the position within each cell before the
// hardware's linear filter gives smooth (C1) interpolation from one read.
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return texture(noiseTex, (i + f + 0.5) * ${(1 / SIZE).toFixed(8)}).r * 2.0 - 1.0;
}

// Fractal sum of value noise, roughly in [-1, 1]. fp is the pixel footprint
// in units of p: each octave fades out once its features shrink to a couple
// of pixels, which stops shimmer from afar and skips the work.
float fbm(vec3 p, int octaves, float fp) {
  float sum = 0.0;
  float amp = 0.5;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    float w = 1.0 - smoothstep(0.25, 0.5, fp);
    if (w <= 0.0) break;
    sum += w * amp * vnoise(p);
    p = p * 2.03 + vec3(17.1, 3.7, 9.3);
    fp *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
`;
