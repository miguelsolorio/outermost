// Sharpness masks for mosaics that mix close-up and distant imagery, computed
// by tools/pipeline/py/sharpness.py from the source's fine-scale contrast.
// The renderer fills the low-resolution regions with synthetic small-scale
// relief so they match the close-up terrain.
//   textures/<body>-sharp/<w>.ktx2

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../../bake/util.ts';
import { ensureFile } from '../fetch.ts';
import { basisu, run, vips } from '../exec.ts';
import type { StepContext } from '../run.ts';

export interface SharpnessJob {
  key: string;
  /** Same source as the body's albedo texture job (both east-center, no reprojection). */
  source: [string, string];
}

const WIDTH = 1024;

export const SHARPNESS_JOBS: SharpnessJob[] = [
  // New Horizons: one hemisphere at ~0.3-1 km/px, the far side at 20-40 km/px.
  { key: 'pluto', source: ['usgs-pluto', 'Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif'] },
  { key: 'charon', source: ['usgs-charon', 'Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif'] },
  // Voyager 2: the southern hemisphere near closest approach; the rest is fill.
  { key: 'triton', source: ['usgs-triton', 'Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif'] },
];

export async function processSharpness(job: SharpnessJob, ctx: StepContext): Promise<void> {
  const src = await ensureFile(job.source[0], job.source[1]);
  const work = join(ctx.workDir, `sharp-${job.key}`);
  const outDir = join(ctx.outDir, 'textures', `${job.key}-sharp`);
  await mkdir(work, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const mid = join(work, 'albedo.png');
  await vips('thumbnail', src, mid, '4096', '--height', '2048', '--size', 'force');
  const png = join(work, `${WIDTH}.png`);
  const out = await run('uv', ['run', '--project', join(ROOT, 'tools/pipeline/py'), 'python', join(ROOT, 'tools/pipeline/py/sharpness.py'), mid, png, String(WIDTH)]);
  console.log(`  ${job.key}: ${out.trim()}`);
  const ktx = join(outDir, `${WIDTH}.ktx2`);
  await basisu(png, ktx, 'etc1s', { linear: true, quality: 128 });
  await ctx.record(`textures/${job.key}-sharp/${WIDTH}.ktx2`, ktx, [job.source[0]], { width: WIDTH, height: WIDTH / 2, kind: 'mask' });
  await rm(work, { recursive: true, force: true });
}
