// Galaxy photographs (CC BY 4.0: ESA/Hubble, ESO, NOIRLab) -> square sprites.
// Each image is padded to a square with black (never cropped), faded to black
// toward the edges, and encoded to KTX2. sprites.json records, per image, the
// angular size of the square (from the published field of view) and where
// celestial north points in the image, so the app can place the photo at the
// galaxy's true position, size and orientation on the sky.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureFile } from '../fetch.ts';
import { basisu, header, readRaw, vips, writeRaw } from '../exec.ts';
import type { StepContext } from '../run.ts';

export interface SpriteSpec {
  key: string;
  source: string;
  file: string;
  /** Catalog name in galaxies/local.json, or explicit coordinates. */
  galaxy?: string;
  ra?: number;
  dec?: number;
  distMpc?: number;
  /** Field of view of the original image (arcmin, width × height). */
  fov: [number, number];
  /** Where north points in the image: degrees clockwise from "up" (negative = toward the left). */
  north: number;
}

export const SPRITES: SpriteSpec[] = [
  { key: 'm31', source: 'img-m31', file: 'heic1112f.jpg', galaxy: 'MESSIER031', fov: [362, 234], north: -1.9 },
  { key: 'm33', source: 'img-m33', file: 'noao-m33_opt.jpg', galaxy: 'MESSIER033', fov: [57.4, 58.6], north: 0.2 },
  { key: 'lmc', source: 'img-lmc', file: 'magellan-ch17-bardon-cc.jpg', galaxy: 'LMC', fov: [1388, 917], north: 64 },
  { key: 'smc', source: 'img-smc', file: 'noirlab2030b.jpg', galaxy: 'SMC', fov: [319, 266], north: -30.1 },
  { key: 'm51', source: 'img-m51', file: 'heic0506a.jpg', galaxy: 'NGC5194', fov: [9.56, 6.64], north: 91.9 },
  { key: 'm101', source: 'img-m101', file: 'heic0602a.jpg', galaxy: 'MESSIER101', fov: [13.2, 10.32], north: 3.5 },
  { key: 'm104', source: 'img-m104', file: 'opo0328a.jpg', galaxy: 'NGC4594', fov: [9.57, 5.36], north: 5.0 },
  { key: 'm81', source: 'img-m81', file: 'heic0710a.jpg', galaxy: 'MESSIER081', fov: [18.85, 12.67], north: -114 },
  { key: 'm82', source: 'img-m82', file: 'noao-m82final.jpg', galaxy: 'MESSIER082', fov: [18.9, 18.5], north: 179 },
  { key: 'ngc253', source: 'img-ngc253', file: 'eso1152a.jpg', galaxy: 'NGC0253', fov: [40.6, 32.1], north: 0 },
  { key: 'cena', source: 'img-cena', file: 'eso1221a.jpg', galaxy: 'NGC5128', fov: [33.9, 33.1], north: 0 },
  // M87: Virgo Cluster center; distance 16.5 Mpc (Mei et al. 2007).
  { key: 'm87', source: 'img-m87', file: 'eso1907b.jpg', ra: 187.7059, dec: 12.3911, distMpc: 16.5, fov: [6.92, 7.0], north: 0 },
  { key: 'm83', source: 'img-m83', file: 'eso0825a.jpg', galaxy: 'NGC5236', fov: [17.6, 17.6], north: 0 },
  { key: 'ic342', source: 'img-ic342', file: 'noao0703a.jpg', galaxy: 'IC0342', fov: [35.5, 35.2], north: -90.2 },
  { key: 'ngc6946', source: 'img-ngc6946', file: 'noao-ngc6946kpno.jpg', galaxy: 'NGC6946', fov: [23.6, 16.3], north: -90 },
];

/**
 * Subtract the photo's sky background level and fade to black inside a circle
 * that fits within the original (unpadded) photo, so neither the photo's
 * rectangle nor its sky glow shows once composited additively.
 */
function cleanEdges(img: { data: Uint8Array; width: number; height: number; bands: number }, photoFrac: number) {
  const { width, height, bands, data } = img;
  const out = new Uint8Array(data.length);
  const cx = width / 2;
  const cy = height / 2;
  const R = (width / 2) * photoFrac;
  // Sky level: median of pixels on a ring just inside the fade circle.
  const ring: number[][] = Array.from({ length: bands }, () => []);
  for (let k = 0; k < 4000; k++) {
    const a = (k / 4000) * 2 * Math.PI;
    const x = Math.floor(cx + Math.cos(a) * R * 0.9);
    const y = Math.floor(cy + Math.sin(a) * R * 0.9);
    const i = (y * width + x) * bands;
    for (let b = 0; b < bands; b++) ring[b].push(data[i + b]);
  }
  const sky = ring.map((v) => v.sort((p, q) => p - q)[Math.floor(v.length / 2)]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
      const t = Math.min(1, Math.max(0, (0.97 - r) / 0.3));
      const f = t * t * (3 - 2 * t);
      const i = (y * width + x) * bands;
      for (let b = 0; b < bands; b++) out[i + b] = Math.round(Math.max(0, data[i + b] - sky[b]) * f * (255 / (255 - sky[b])));
    }
  }
  return { ...img, data: out };
}

export async function processSprites(ctx: StepContext): Promise<void> {
  const outDir = join(ctx.outDir, 'galaxies', 'sprites');
  const work = join(ctx.workDir, 'sprites');
  await mkdir(outDir, { recursive: true });
  await mkdir(work, { recursive: true });
  const meta = [];
  for (const s of SPRITES) {
    const src = await ensureFile(s.source, s.file);
    const h = await header(src);
    const side = Math.max(h.width, h.height);
    const padded = join(work, `${s.key}-pad.v`);
    await vips('embed', src, padded, String(Math.floor((side - h.width) / 2)), String(Math.floor((side - h.height) / 2)), String(side), String(side), '--extend', 'black');
    const big = join(work, `${s.key}-2048.v`);
    await vips('thumbnail', padded, big, '2048', '--height', '2048', '--size', 'force');
    const img = cleanEdges(await readRaw(big, join(work, 'raw.bin')), Math.min(h.width, h.height) / side);
    const master = join(work, `${s.key}-2048.png`);
    await writeRaw(img, master, join(work, 'raw.bin'));
    for (const w of [1024, 2048]) {
      const png = w === 2048 ? master : join(work, `${s.key}-${w}.png`);
      if (w !== 2048) await vips('thumbnail', master, png, String(w), '--height', String(w), '--size', 'force');
      const out = join(outDir, `${s.key}-${w}.ktx2`);
      await basisu(png, out, 'etc1s', { quality: 85 });
      await ctx.record(`galaxies/sprites/${s.key}-${w}.ktx2`, out, [s.source], { width: w, height: w });
    }
    // The square's angular size is the longer side of the original field of view.
    const fovSquare = h.width >= h.height ? s.fov[0] : s.fov[1];
    meta.push({ key: s.key, source: s.source, galaxy: s.galaxy, ra: s.ra, dec: s.dec, distMpc: s.distMpc, sizeArcmin: fovSquare, north: s.north });
    console.log(`  sprite ${s.key}: ${h.width}x${h.height} -> ${fovSquare}′ square`);
  }
  await writeFile(join(outDir, 'sprites.json'), JSON.stringify({ license: 'CC BY 4.0 (see data/sources.json for credits)', sprites: meta }, null, 1));
  await ctx.record('galaxies/sprites/sprites.json', join(outDir, 'sprites.json'), SPRITES.map((s) => s.source));
  await rm(work, { recursive: true, force: true });
}
