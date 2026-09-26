// Relief (normal) maps from global elevation models, so terrain catches the
// light near the terminator. Computed by tools/pipeline/py/relief.py with true
// slopes (no vertical exaggeration), encoded UASTC (linear) with mipmaps.
//   textures/<body>-normal/<w>.ktx2

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../../bake/util.ts';
import { ensureFile } from '../fetch.ts';
import { basisu, run, vips } from '../exec.ts';
import type { StepContext } from '../run.ts';

export interface ReliefJob {
  key: string;
  source: [string, string];
  format: 'tif' | 'png8' | `msb16:${number}x${number}`;
  metersPerUnit: number;
  radiusKm: number;
  /** Map starts at 0°E (PDS convention) rather than being centered on 0°. */
  lonShift: boolean;
  widths: number[];
  smoothPx?: number;
}

export const RELIEF_JOBS: ReliefJob[] = [
  // LOLA via the SVS CGI Moon Kit: uint16 half-meters, centered on 0°.
  { key: 'moon', source: ['svs-cgi-moon-kit', 'ldem_16_uint.tif'], format: 'tif', metersPerUnit: 0.5, radiusKm: 1737.4, lonShift: false, widths: [2048, 4096] },
  // MOLA MEGDR 16 px/deg: big-endian int16 meters, 0..360°E.
  { key: 'mars', source: ['mola-megdr-16', 'megt90n000eb.img'], format: 'msb16:5760x2880', metersPerUnit: 1, radiusKm: 3396.0, lonShift: true, widths: [2048, 4096] },
  // GEBCO-derived land elevation, 8-bit scaled 0-6400 m (NASA Earth Observatory); oceans flat.
  { key: 'earth', source: ['gebco-2008-elev', 'gebco_08_rev_elev_21600x10800.png'], format: 'png8', metersPerUnit: 6400 / 255, radiusKm: 6371.0, lonShift: false, widths: [4096, 8192], smoothPx: 1.5 },
];

export async function processRelief(job: ReliefJob, ctx: StepContext): Promise<void> {
  const src = await ensureFile(job.source[0], job.source[1]);
  const work = join(ctx.workDir, `relief-${job.key}`);
  const outDir = join(ctx.outDir, 'textures', `${job.key}-normal`);
  await mkdir(work, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const top = Math.max(...job.widths);
  const master = join(work, `${top}.png`);
  const args = [src, job.format, String(job.metersPerUnit), String(job.radiusKm), job.lonShift ? '1' : '0', master, String(top), String(job.smoothPx ?? 0)];
  const out = await run('uv', ['run', '--project', join(ROOT, 'tools/pipeline/py'), 'python', join(ROOT, 'tools/pipeline/py/relief.py'), ...args]);
  console.log(`  ${job.key}: ${out.trim()}`);
  for (const w of job.widths) {
    const png = w === top ? master : join(work, `${w}.png`);
    if (w !== top) await vips('thumbnail', master, png, String(w), '--height', String(w / 2), '--size', 'force');
    const ktx = join(outDir, `${w}.ktx2`);
    await basisu(png, ktx, 'uastc', { linear: true, quality: 80 });
    await ctx.record(`textures/${job.key}-normal/${w}.ktx2`, ktx, [job.source[0]], { width: w, height: w / 2, kind: 'normal' });
  }
  await rm(work, { recursive: true, force: true });
}
