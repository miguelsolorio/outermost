// Asset pipeline entry point. Processes raw sources (downloaded on demand into
// .cache/sources) into web-ready assets under public/assets/, and maintains
// public/assets/manifest.json with size, sha256 and source ids per file.
//   node tools/pipeline/run.ts                 # everything
//   node tools/pipeline/run.ts textures:moon   # one job

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { CACHE_DIR, ROOT } from '../bake/util.ts';
import { processTexture } from './steps/textures.ts';
import { processStars } from './steps/stars.ts';
import { processGalaxies } from './steps/galaxies.ts';
import { processCmb } from './steps/cmb.ts';
import { processSprites } from './steps/sprites.ts';
import { processSmallBodies } from './steps/smallbodies.ts';
import { processRelief, RELIEF_JOBS } from './steps/relief.ts';
import { processTileSet } from './steps/tiles.ts';
import { TEXTURE_JOBS, TILE_JOBS } from './jobs.ts';

export interface StepContext {
  outDir: string;
  workDir: string;
  record(path: string, file: string, sources: string[], extra?: Record<string, unknown>): Promise<void>;
}

const OUT = join(ROOT, 'public', 'assets');
const MANIFEST = join(OUT, 'manifest.json');

interface Manifest {
  version: string;
  generated: string;
  files: Record<string, { path: string; bytes: number; sha256: string; sources: string[]; [k: string]: unknown }>;
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function loadManifest(): Promise<Manifest> {
  try {
    return JSON.parse(await readFile(MANIFEST, 'utf8'));
  } catch {
    return { version: '1', generated: '', files: {} };
  }
}

// Several pipeline runs may execute in parallel: every update takes a lock,
// re-reads the manifest from disk, merges one entry and writes atomically.
const LOCK = MANIFEST + '.lock';
async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      await mkdir(LOCK);
      break;
    } catch {
      if (i > 600) throw new Error(`manifest lock stuck: remove ${LOCK}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(LOCK, { recursive: true, force: true });
  }
}

const ctx: StepContext = {
  outDir: OUT,
  workDir: join(CACHE_DIR, 'work'),
  async record(path, file, sources, extra = {}) {
    const { size } = await stat(file);
    const entry = { path: relative(OUT, file), bytes: size, sha256: await sha256(file), sources, ...extra };
    await withLock(async () => {
      const manifest = await loadManifest();
      manifest.files[path] = entry;
      manifest.generated = new Date().toISOString();
      manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
      const tmp = `${MANIFEST}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n');
      await rename(tmp, MANIFEST);
    });
  },
};

await mkdir(OUT, { recursive: true });
const wanted = process.argv.slice(2);
const pick = (id: string) => !wanted.length || wanted.some((w) => id === w || id.startsWith(w + ':') || w === id.split(':')[0]);

for (const job of TEXTURE_JOBS) {
  const id = `textures:${job.key}`;
  if (!pick(id)) continue;
  console.log(`pipeline ${id}`);
  await processTexture(job, ctx);
}

for (const job of TILE_JOBS) {
  const id = `tiles:${job.set}`;
  if (!pick(id)) continue;
  console.log(`pipeline ${id}`);
  await processTileSet(job, ctx);
}

for (const job of RELIEF_JOBS) {
  const id = `relief:${job.key}`;
  if (!pick(id)) continue;
  console.log(`pipeline ${id}`);
  await processRelief(job, ctx);
}

if (pick('stars')) {
  console.log('pipeline stars');
  await processStars(ctx);
}

if (pick('galaxies')) {
  console.log('pipeline galaxies');
  await processGalaxies(ctx);
}

if (pick('cmb')) {
  console.log('pipeline cmb');
  await processCmb(ctx);
}

if (pick('sprites')) {
  console.log('pipeline sprites');
  await processSprites(ctx);
}

if (pick('smallbodies')) {
  console.log('pipeline smallbodies');
  await processSmallBodies(ctx);
}

const final = await loadManifest();
const total = Object.values(final.files).reduce((s, f) => s + f.bytes + (typeof f.bytesTotal === 'number' ? f.bytesTotal : 0), 0);
console.log(`manifest: ${Object.keys(final.files).length} files, ${(total / 1e6).toFixed(1)} MB`);
