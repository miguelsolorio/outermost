// Detail tiles for close-up planet views, on a geographic (equirectangular)
// grid: level L has 2^(L+1) × 2^L tiles, each spanning 180°/2^L. The global
// textures already cover up to 8192 px (L3), so only the finer levels are
// tiled. Each tile holds 512 px of content inside a 16 px gutter copied from
// its neighbors (wrapping in longitude, clamped at the poles), so filtering
// and the first four mip levels never bleed across tiles, and every mip stays
// a multiple of the 4×4 compression block.
//   assets/tiles/<set>/<L>/<x>_<y>.ktx2      (x from 180°W, y from the north)
//   assets/tiles/<set>/index.json            (layout + per-tile sizes)

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureFile } from '../fetch.ts';
import { header, run, vips } from '../exec.ts';
import type { StepContext } from '../run.ts';

export const TILE = 512;
export const GUTTER = 16;

export interface TileSetJob {
  set: string;
  source: [string, string];
  levels: number[];
  bands?: 1 | 3;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

export async function processTileSet(job: TileSetJob, ctx: StepContext): Promise<void> {
  const src = await ensureFile(job.source[0], job.source[1]);
  const work = join(ctx.workDir, `tiles-${job.set}`);
  const outRoot = join(ctx.outDir, 'tiles', job.set);
  await mkdir(work, { recursive: true });
  const h = await header(src);
  const nb = job.bands ?? 3;
  const index: { tile: number; gutter: number; levels: Record<string, { nx: number; ny: number; bytes: number[] }> } = {
    tile: TILE,
    gutter: GUTTER,
    levels: {},
  };
  let total = 0;
  const hash = createHash('sha256');
  for (const L of job.levels) {
    const nx = 2 ** (L + 1);
    const ny = 2 ** L;
    const W = nx * TILE;
    const H = ny * TILE;
    if (W > h.width * 1.01) console.warn(`  tiles ${job.set} L${L}: ${W} px is wider than the ${h.width} px source`);
    const level = join(work, `L${L}.v`);
    await vips('thumbnail', src, level, String(W), '--height', String(H), '--size', 'force');
    let img = level;
    if (h.bands > nb) {
      img = join(work, `L${L}b.v`);
      await vips('extract_band', level, img, '0', '--n', String(nb));
    }
    // Wrap in longitude: [last GUTTER columns | image | first GUTTER columns].
    const left = join(work, 'left.v');
    const right = join(work, 'right.v');
    await vips('extract_area', img, left, String(W - GUTTER), '0', String(GUTTER), String(H));
    await vips('extract_area', img, right, '0', '0', String(GUTTER), String(H));
    const half = join(work, 'half.v');
    const row = join(work, 'row.v');
    await vips('join', left, img, half, 'horizontal');
    await vips('join', half, right, row, 'horizontal');
    // Clamp at the poles: repeat the edge rows.
    const wide = join(work, `L${L}w.v`);
    await vips('embed', row, wide, '0', String(GUTTER), String(W + 2 * GUTTER), String(H + 2 * GUTTER), '--extend', 'copy');

    const outDir = join(outRoot, String(L));
    await mkdir(outDir, { recursive: true });
    const pngDir = join(work, `png${L}`);
    await mkdir(pngDir, { recursive: true });
    const cells: Array<[number, number]> = [];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) cells.push([x, y]);
    const S = TILE + 2 * GUTTER;
    await mapLimit(cells, 8, async ([x, y]) => {
      await vips('extract_area', wide, join(pngDir, `${x}_${y}.png`), String(x * TILE), String(y * TILE), String(S), String(S));
    });
    // basisu is multithreaded; batch files to amortize startup.
    const pngs = cells.map(([x, y]) => join(pngDir, `${x}_${y}.png`));
    for (let i = 0; i < pngs.length; i += 64) {
      await run('basisu', ['-ktx2', '-mipmap', '-y_flip', '-etc1s', '-quality', '96', '-effort', '4', '-output_path', outDir, ...pngs.slice(i, i + 64)]);
    }
    const bytes: number[] = [];
    for (const [x, y] of cells) {
      const buf = await readFile(join(outDir, `${x}_${y}.ktx2`));
      hash.update(buf);
      bytes.push(buf.length);
      total += buf.length;
    }
    index.levels[L] = { nx, ny, bytes };
    await rm(pngDir, { recursive: true, force: true });
    console.log(`  tiles ${job.set} L${L}: ${nx}×${ny}, ${(bytes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB`);
  }
  const indexPath = join(outRoot, 'index.json');
  await writeFile(indexPath, JSON.stringify(index));
  await ctx.record(`tiles/${job.set}/index.json`, indexPath, [job.source[0]], {
    tiles: Object.values(index.levels).reduce((s, l) => s + l.bytes.length, 0),
    bytesTotal: total,
    sha256Tiles: hash.digest('hex'),
  });
  await rm(work, { recursive: true, force: true });
}
