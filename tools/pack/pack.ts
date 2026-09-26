// Bundles public/assets into a tarball for a GitHub Release, so the site can
// be built and deployed without re-running the asset pipeline.
//   node tools/pack/pack.ts            -> .cache/pack/space-assets-<date>.tar (+ parts, SHA256SUMS)
// Upload is a separate, deliberate step (see the printed command).

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { CACHE_DIR, ROOT } from '../bake/util.ts';

const ASSETS = join(ROOT, 'public', 'assets');
const OUT = join(CACHE_DIR, 'pack');
/** GitHub release assets must be under 2 GiB each. */
const PART_BYTES = 1_900_000_000;
/** GitHub Pages sites are limited to 1 GB. */
const PAGES_LIMIT = 1_000_000_000;

async function du(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await du(p) : (await stat(p)).size;
  }
  return total;
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

const manifest = JSON.parse(await readFile(join(ASSETS, 'manifest.json'), 'utf8')) as { generated: string };
const bytes = await du(ASSETS);
console.log(`assets: ${(bytes / 1e6).toFixed(1)} MB`);
if (bytes > PAGES_LIMIT * 0.9) console.warn(`warning: over 90% of the 1 GB GitHub Pages limit`);

await mkdir(OUT, { recursive: true });
const stamp = manifest.generated.slice(0, 10);
const name = `space-assets-${stamp}.tar`;
const tar = join(OUT, name);
// KTX2 textures are already compressed; a plain tar keeps packing fast.
execFileSync('tar', ['-cf', tar, '-C', join(ROOT, 'public'), 'assets']);
const files = [name];
if ((await stat(tar)).size > PART_BYTES) {
  execFileSync('split', ['-b', String(PART_BYTES), '-d', '-a', '2', tar, `${tar}.part`]);
  files.splice(0, 1, ...(await readdir(OUT)).filter((f) => f.startsWith(`${name}.part`)).sort());
}
const sums = await Promise.all(files.map(async (f) => `${await sha256(join(OUT, f))}  ${f}`));
const { writeFile } = await import('node:fs/promises');
await writeFile(join(OUT, 'SHA256SUMS'), sums.join('\n') + '\n');
console.log(`wrote ${files.join(', ')} and SHA256SUMS in ${OUT}`);
console.log(`\nTo publish (after review):\n  gh release create assets-${stamp} ${files.map((f) => join(OUT, f)).join(' ')} ${join(OUT, 'SHA256SUMS')} --title "Assets ${stamp}" --notes "Processed textures and catalogs (see data/sources.json for licenses)"`);
