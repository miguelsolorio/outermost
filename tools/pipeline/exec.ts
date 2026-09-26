// Thin wrappers around the vips and basisu command-line tools.

import { spawn } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';

export function run(cmd: string, args: string[], { quiet = true } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} ${args.join(' ')} failed (${code}):\n${err || out}`));
    });
    if (!quiet) p.stdout.pipe(process.stdout);
  });
}

export const vips = (...args: string[]) => run('vips', args);

export async function header(path: string): Promise<{ width: number; height: number; bands: number; format: string }> {
  const [w, h, b, f] = await Promise.all(
    ['width', 'height', 'bands', 'format'].map((k) => run('vipsheader', ['-f', k, path]).then((s) => s.trim())),
  );
  return { width: Number(w), height: Number(h), bands: Number(b), format: f };
}

/** Load an image as raw interleaved uchar pixels. */
export async function readRaw(path: string, tmp: string): Promise<{ data: Uint8Array; width: number; height: number; bands: number }> {
  const h = await header(path);
  await vips('rawsave', path, tmp);
  const data = new Uint8Array(await readFile(tmp));
  await rm(tmp, { force: true });
  return { data, width: h.width, height: h.height, bands: h.bands };
}

/** Write raw interleaved uchar pixels to any vips-supported format (by extension). */
export async function writeRaw(
  img: { data: Uint8Array; width: number; height: number; bands: number },
  out: string,
  tmp: string,
): Promise<void> {
  await writeFile(tmp, img.data);
  const v = `${tmp}.v`;
  await vips('rawload', tmp, v, String(img.width), String(img.height), String(img.bands));
  await vips('copy', v, out, '--interpretation', img.bands >= 3 ? 'srgb' : 'b-w');
  await rm(tmp, { force: true });
  await rm(v, { force: true });
}

export type Encoding = 'etc1s' | 'uastc';

/** Encode a PNG to KTX2 with mipmaps. Images are flipped so row 0 is the south pole (v = 0). */
export async function basisu(input: string, output: string, enc: Encoding, { linear = false, quality = 90 } = {}): Promise<void> {
  const args = ['-ktx2', '-mipmap', '-y_flip', '-output_file', output];
  if (enc === 'uastc') args.push('-uastc', '-quality', String(quality), '-effort', '3');
  else args.push('-etc1s', '-quality', String(quality), '-effort', '4');
  if (linear) args.push('-linear');
  args.push(input);
  await run('basisu', args);
}
