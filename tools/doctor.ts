// Checks the local toolchain for the asset pipeline.
//   node tools/doctor.ts
// The app itself only needs Node; the pipeline (npm run pipeline) needs vips,
// basisu and uv, plus ~6 GB free for cached sources and intermediates.

import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';

const checks: Array<[string, () => string]> = [
  ['node >= 24 (native TypeScript)', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 24) throw new Error(`found ${process.versions.node}`);
    return process.versions.node;
  }],
  ['vips (libvips CLI)', () => execFileSync('vips', ['--version']).toString().trim()],
  ['basisu (Basis Universal encoder)', () => execFileSync('basisu', ['-version']).toString().split('\n')[0].trim()],
  ['uv (Python for the CMB step)', () => execFileSync('uv', ['--version']).toString().trim()],
  ['free disk >= 6 GB', () => {
    const s = statfsSync('.');
    const gb = (s.bavail * s.bsize) / 1e9;
    if (gb < 6) throw new Error(`${gb.toFixed(1)} GB free`);
    return `${gb.toFixed(1)} GB free`;
  }],
];

let ok = true;
for (const [name, fn] of checks) {
  try {
    console.log(`✓ ${name}: ${fn()}`);
  } catch (err) {
    ok = false;
    console.log(`✗ ${name}: ${(err as Error).message.split('\n')[0]}`);
  }
}
if (!ok) {
  console.log('\nInstall with: brew install vips basis_universal uv');
  process.exitCode = 1;
}
