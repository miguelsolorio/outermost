// CMB sphere texture from the Planck PR3 SMICA map (via tools/pipeline/py/cmb.py).

import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../../bake/util.ts';
import { ensureFile } from '../fetch.ts';
import { basisu, run, vips } from '../exec.ts';
import type { StepContext } from '../run.ts';

export async function processCmb(ctx: StepContext): Promise<void> {
  const src = await ensureFile('planck-smica', 'COM_CMB_IQU-smica-nosz_2048_R3.00_full.fits');
  const work = join(ctx.workDir, 'cmb');
  const outDir = join(ctx.outDir, 'textures', 'cmb');
  await mkdir(work, { recursive: true });
  await mkdir(outDir, { recursive: true });
  const master = join(work, '8192.png');
  const out = await run('uv', ['run', '--project', join(ROOT, 'tools/pipeline/py'), 'python', join(ROOT, 'tools/pipeline/py/cmb.py'), src, master, '8192']);
  console.log(out.trim().split('\n').map((l) => `  ${l}`).join('\n'));
  for (const w of [4096, 8192]) {
    const png = w === 8192 ? master : join(work, `${w}.png`);
    if (w !== 8192) await vips('thumbnail', master, png, String(w), '--height', String(w / 2), '--size', 'force');
    const ktx = join(outDir, `${w}.ktx2`);
    await basisu(png, ktx, 'uastc', { quality: 60 });
    await ctx.record(`textures/cmb/${w}.ktx2`, ktx, ['planck-smica'], { width: w, height: w / 2, frame: 'galactic' });
  }
  await rm(work, { recursive: true, force: true });
}
