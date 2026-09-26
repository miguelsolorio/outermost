// Downloads raw source files listed in data/sources.json into the cache,
// resuming partial downloads, and records sha256 + size in
// data/sources.lock.json so a pipeline run is reproducible.
//   node tools/pipeline/fetch.ts [sourceId ...]

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { CACHE_DIR, ROOT } from '../bake/util.ts';

interface SourceFile { name: string; url: string }
interface Source { id: string; files?: SourceFile[] }
interface LockEntry { url: string; bytes: number; sha256: string; retrieved: string }

export const SOURCES_DIR = join(CACHE_DIR, 'sources');
const LOCK = join(ROOT, 'data', 'sources.lock.json');

export async function loadSources(): Promise<Source[]> {
  return JSON.parse(await readFile(join(ROOT, 'data', 'sources.json'), 'utf8')).sources;
}

async function loadLock(): Promise<Record<string, LockEntry>> {
  try {
    return JSON.parse(await readFile(LOCK, 'utf8'));
  } catch {
    return {};
  }
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function curl(url: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // -C - resumes; --fail makes HTTP errors fatal; retries cover flaky mirrors.
    const p = spawn('curl', ['-L', '--fail', '-C', '-', '--retry', '5', '--retry-delay', '3', '-sS', '-o', out, url], {
      stdio: 'inherit',
    });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`curl exited ${code} for ${url}`))));
  });
}

/** Ensure a source file is present locally; returns its path. */
export async function ensureFile(sourceId: string, name: string): Promise<string> {
  const sources = await loadSources();
  const src = sources.find((s) => s.id === sourceId);
  const file = src?.files?.find((f) => f.name === name);
  if (!file) throw new Error(`Unknown source file ${sourceId}/${name}`);
  const dir = join(SOURCES_DIR, sourceId);
  const path = join(dir, name);
  const lock = await loadLock();
  const key = `${sourceId}/${name}`;
  const done = await stat(path).then((s) => s.size, () => -1);
  if (lock[key] && done === lock[key].bytes) return path;
  await mkdir(dir, { recursive: true });
  console.log(`  fetch ${key}`);
  await curl(file.url, path);
  const bytes = (await stat(path)).size;
  const digest = await sha256(path);
  if (lock[key] && lock[key].sha256 !== digest) {
    console.warn(`  WARNING: ${key} changed upstream (sha256 ${lock[key].sha256.slice(0, 12)} -> ${digest.slice(0, 12)})`);
  }
  const fresh = await loadLock();
  fresh[key] = { url: file.url, bytes, sha256: digest, retrieved: new Date().toISOString().slice(0, 10) };
  await writeFile(LOCK, JSON.stringify(Object.fromEntries(Object.entries(fresh).sort()), null, 2) + '\n');
  return path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const wanted = process.argv.slice(2);
  for (const src of await loadSources()) {
    if (!src.files || (wanted.length && !wanted.includes(src.id))) continue;
    for (const f of src.files) await ensureFile(src.id, f.name);
  }
}
