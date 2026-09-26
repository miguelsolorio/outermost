// Shared helpers for bake scripts (build-time data fetchers).

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const CACHE_DIR = process.env.SPACE_CACHE_DIR ?? join(ROOT, '.cache');

export const today = (): string => new Date().toISOString().slice(0, 10);

/** Fetch text with a small on-disk cache so repeated bakes don't hammer NASA servers. */
export async function fetchText(url: string, { cache = true } = {}): Promise<string> {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 24);
  const path = join(CACHE_DIR, 'http', key);
  if (cache) {
    try {
      const s = await stat(path);
      if (Date.now() - s.mtimeMs < 7 * 86_400_000) return await readFile(path, 'utf8');
    } catch {
      // not cached
    }
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'outermost-bake/0.1' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // NSSDCA pages are latin-1; decode bytes > 127 accordingly when not valid UTF-8.
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
      return text;
    } catch (err) {
      if (attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

export function stripHtml(html: string): string {
  return html
    .replace(/<sup>/gi, '')
    .replace(/<\/sup>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\t/g, '    ');
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
