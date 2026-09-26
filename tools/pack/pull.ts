// Downloads a packed asset bundle from a GitHub Release into public/assets.
//   node tools/pack/pull.ts [tag]     (default: the newest release tagged assets-*)
// Uses the GitHub CLI, which authenticates via GH_TOKEN in CI.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, ROOT } from '../bake/util.ts';

const OUT = join(CACHE_DIR, 'pull');
const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8' });

let tag = process.argv[2];
if (!tag) {
  const list = JSON.parse(gh('release', 'list', '--json', 'tagName,createdAt', '--limit', '50')) as Array<{ tagName: string; createdAt: string }>;
  tag = list.filter((r) => r.tagName.startsWith('assets-')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.tagName;
  if (!tag) throw new Error('no assets-* release found');
}
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
console.log(`downloading ${tag}`);
gh('release', 'download', tag, '--dir', OUT);

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
const sums = (await readFile(join(OUT, 'SHA256SUMS'), 'utf8')).trim().split('\n').map((l) => l.split(/\s+/));
for (const [hash, file] of sums) {
  if ((await sha256(join(OUT, file))) !== hash) throw new Error(`checksum mismatch: ${file}`);
}
const parts = (await readdir(OUT)).filter((f) => f.endsWith('.tar') || /\.tar\.part\d+$/.test(f)).sort();
const tar = parts.length === 1 && parts[0].endsWith('.tar') ? join(OUT, parts[0]) : join(OUT, 'joined.tar');
if (tar.endsWith('joined.tar')) execFileSync('sh', ['-c', `cat ${parts.map((p) => JSON.stringify(join(OUT, p))).join(' ')} > ${JSON.stringify(tar)}`]);
execFileSync('tar', ['-xf', tar, '-C', join(ROOT, 'public')]);
console.log(`extracted into public/assets`);
