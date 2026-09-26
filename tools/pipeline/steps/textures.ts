// Planet texture processing. Every output is normalized to our convention:
// simple cylindrical, planetocentric latitude, east-positive longitude with
// 0° at the image center (u = (lon + 180°)/360°), north at the top.
// Then resized to power-of-two tiers and encoded to KTX2.

import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ensureFile } from '../fetch.ts';
import { basisu, header, readRaw, vips, writeRaw, type Encoding } from '../exec.ts';
import type { StepContext } from '../run.ts';

type Raw = { data: Uint8Array; width: number; height: number; bands: number };

export interface TextureJob {
  key: string;
  source: [sourceId: string, file: string];
  /** How the source's columns map to longitude. */
  lon: 'east-center' | 'west-left0' | 'east-left0';
  /** Source latitude is planetographic with this flattening (converted to planetocentric). */
  planetographicF?: number;
  /** Source grid includes both edges (e.g. 3601x1801); drop the duplicate last column. */
  dropLastColumn?: boolean;
  /** Fill missing polar data with the zonal mean of the nearest valid latitude. */
  fillPoles?: boolean;
  /** Keep only luminance and multiply by this linear tint (for enhanced-color sources). */
  greyTint?: [number, number, number];
  widths: number[];
  encoding: Encoding;
  bands?: 1 | 3;
  /** Source is linear-light float (e.g. scRGB EXR): convert with the sRGB transfer curve. */
  linearFloat?: boolean;
  note?: string;
}

// ---- pixel operations (at the largest tier resolution) -------------------------

function wrapHalf(img: Raw): Raw {
  const { width, height, bands } = img;
  const out = new Uint8Array(img.data.length);
  const half = width >> 1;
  const rowBytes = width * bands;
  for (let y = 0; y < height; y++) {
    const r = y * rowBytes;
    out.set(img.data.subarray(r + half * bands, r + rowBytes), r);
    out.set(img.data.subarray(r, r + half * bands), r + (width - half) * bands);
  }
  return { ...img, data: out };
}

/**
 * After wrapping, the source's left/right edges meet at the center column.
 * Mosaic edges rarely match, so interpolate a few columns across the seam.
 */
function healCenterSeam(img: Raw, radius = 3): Raw {
  const { width, height, bands } = img;
  const data = img.data.slice();
  const c = width >> 1;
  const x0 = c - radius - 1;
  const x1 = c + radius;
  for (let y = 0; y < height; y++) {
    for (let x = x0 + 1; x < x1; x++) {
      const t = (x - x0) / (x1 - x0);
      for (let b = 0; b < bands; b++) {
        const a0 = img.data[(y * width + x0) * bands + b];
        const a1 = img.data[(y * width + x1) * bands + b];
        data[(y * width + x) * bands + b] = Math.round(a0 * (1 - t) + a1 * t);
      }
    }
  }
  return { ...img, data };
}

/** Resample rows from planetographic to planetocentric latitude. */
function graphicToCentric(img: Raw, f: number): Raw {
  const { width, height, bands } = img;
  const out = new Uint8Array(img.data.length);
  const k = 1 / (1 - f) ** 2;
  const rowBytes = width * bands;
  for (let y = 0; y < height; y++) {
    const latC = (90 - ((y + 0.5) * 180) / height) * (Math.PI / 180);
    const latG = Math.atan(Math.tan(latC) * k);
    const sy = Math.min(height - 1, Math.max(0, ((90 - (latG * 180) / Math.PI) / 180) * height - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(height - 1, y0 + 1);
    const t = sy - y0;
    for (let i = 0; i < rowBytes; i++) {
      out[y * rowBytes + i] = Math.round(img.data[y0 * rowBytes + i] * (1 - t) + img.data[y1 * rowBytes + i] * t);
    }
  }
  return { ...img, data: out };
}

/**
 * Replace missing polar coverage with the zonal mean of the nearest valid
 * latitude. Rows are invalid when mostly black, or much darker than the
 * median row (no-data fill colors); the invalid band is dilated slightly to
 * drop the colored mosaic fringe, and blended back over a few rows.
 */
function fillPoles(img: Raw): Raw {
  const { width, height, bands } = img;
  const data = img.data.slice();
  const rowLum: number[] = [];
  const rowMean: number[][] = [];
  const blackFrac: number[] = [];
  for (let y = 0; y < height; y++) {
    const sum = new Array(bands).fill(0);
    let n = 0;
    let black = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * bands;
      let lum = 0;
      for (let b = 0; b < bands; b++) lum += data[i + b];
      if (lum <= 3 * bands) {
        black++;
        continue;
      }
      for (let b = 0; b < bands; b++) sum[b] += data[i + b];
      n++;
    }
    const mean = sum.map((s) => s / Math.max(n, 1));
    rowMean.push(mean);
    rowLum.push(mean.reduce((a, b) => a + b, 0) / bands);
    blackFrac.push(black / width);
  }
  const median = [...rowLum].sort((a, b) => a - b)[height >> 1];
  const invalid = rowLum.map((l, y) => blackFrac[y] > 0.5 || l < 0.45 * median);
  // Dilate toward the equator to drop fringe rows next to the gap.
  const pad = Math.ceil(height * 0.012);
  const bad = invalid.map((_, y) => {
    for (let d = -pad; d <= pad; d++) if (invalid[y + d]) return true;
    return false;
  });
  const nearestValid = (y: number): number => {
    for (let d = 1; d < height; d++) {
      if (y - d >= 0 && !bad[y - d]) return y - d;
      if (y + d < height && !bad[y + d]) return y + d;
    }
    return y;
  };
  const blend = Math.ceil(height * 0.01);
  for (let y = 0; y < height; y++) {
    if (!bad[y]) {
      // Fill scattered black pixels in otherwise valid rows.
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * bands;
        let lum = 0;
        for (let b = 0; b < bands; b++) lum += data[i + b];
        if (lum <= 3 * bands) for (let b = 0; b < bands; b++) data[i + b] = Math.round(rowMean[y][b]);
      }
      continue;
    }
    const src = nearestValid(y);
    // Zonal mean of a few valid rows next to the gap.
    const acc = new Array(bands).fill(0);
    let k = 0;
    for (let d = 0; d < blend * 3; d++) {
      const yy = src + (src > y ? d : -d);
      if (yy < 0 || yy >= height || bad[yy]) break;
      rowMean[yy].forEach((v, b) => (acc[b] += v));
      k++;
    }
    const m = acc.map((v) => v / Math.max(k, 1));
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * bands;
      for (let b = 0; b < bands; b++) data[i + b] = Math.round(m[b]);
    }
  }
  // Soften the seam between filled and real rows.
  for (let y = 1; y < height; y++) {
    if (bad[y] === bad[y - 1]) continue;
    const edge = bad[y] ? y : y - 1; // first filled row next to data
    const dir = bad[y] ? 1 : -1;
    for (let d = 0; d < blend; d++) {
      const yy = edge + dir * d;
      if (yy < 0 || yy >= height || !bad[yy]) break;
      const t = 1 - d / blend;
      const ref = edge - dir;
      for (let x = 0; x < width; x++) {
        const i = (yy * width + x) * bands;
        const j = (ref * width + x) * bands;
        for (let b = 0; b < bands; b++) data[i + b] = Math.round(data[i + b] * (1 - t * 0.5) + data[j + b] * t * 0.5);
      }
    }
  }
  return { ...img, data };
}

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function greyTint(img: Raw, tint: [number, number, number]): Raw {
  const { bands } = img;
  const data = new Uint8Array(img.data.length);
  for (let i = 0; i < img.data.length; i += bands) {
    const r = toLin(img.data[i] / 255);
    const g = toLin(img.data[i + 1] / 255);
    const b = toLin(img.data[i + 2] / 255);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    data[i] = Math.round(255 * toSrgb(Math.min(1, y * tint[0])));
    data[i + 1] = Math.round(255 * toSrgb(Math.min(1, y * tint[1])));
    data[i + 2] = Math.round(255 * toSrgb(Math.min(1, y * tint[2])));
  }
  return { ...img, data };
}

// ---- job runner ---------------------------------------------------------------

export async function processTexture(job: TextureJob, ctx: StepContext): Promise<void> {
  const src = await ensureFile(job.source[0], job.source[1]);
  const outDir = join(ctx.outDir, 'textures', job.key);
  const work = join(ctx.workDir, job.key);
  await mkdir(outDir, { recursive: true });
  await mkdir(work, { recursive: true });

  const maxW = Math.max(...job.widths);
  const hdr = await header(src);
  const wantBands = job.bands ?? 3;

  // 1. Normalize format: 8-bit, band count, trimmed duplicate column.
  let stage = join(work, 'stage0.v');
  const srcW = job.dropLastColumn ? hdr.width - 1 : hdr.width;
  await vips('extract_area', src, stage, '0', '0', String(srcW), String(hdr.height));
  if (job.linearFloat) {
    const s2 = join(work, 'stage0b.v');
    await vips('colourspace', stage, s2, 'srgb');
    stage = s2;
  } else if (hdr.format !== 'uchar') {
    const s2 = join(work, 'stage0b.v');
    await vips('cast', stage, s2, 'uchar');
    stage = s2;
  }
  if (hdr.bands > wantBands) {
    const s3 = join(work, 'stage0c.v');
    await vips('extract_band', stage, s3, '0', '--n', String(wantBands));
    stage = s3;
  }

  // 2. Resize to the largest tier (never upsample by more than the next power of two).
  const big = join(work, `${maxW}.v`);
  await vips('thumbnail', stage, big, String(maxW), '--height', String(maxW / 2), '--size', 'force');

  // 3. Pixel-level normalization at that size.
  let img = await readRaw(big, join(work, 'raw.bin'));
  if (job.lon === 'west-left0' || job.lon === 'east-left0') img = healCenterSeam(wrapHalf(img));
  if (job.planetographicF) img = graphicToCentric(img, job.planetographicF);
  if (job.fillPoles) img = fillPoles(img);
  if (job.greyTint && img.bands >= 3) img = greyTint(img, job.greyTint);
  const master = join(work, `${maxW}.png`);
  await writeRaw(img, master, join(work, 'raw.bin'));

  // 4. Tiers + KTX2.
  for (const w of job.widths) {
    const png = w === maxW ? master : join(work, `${w}.png`);
    if (w !== maxW) await vips('thumbnail', master, png, String(w), '--height', String(w / 2), '--size', 'force');
    const out = join(outDir, `${w}.ktx2`);
    await basisu(png, out, job.encoding);
    const { size } = await stat(out);
    await ctx.record(`textures/${job.key}/${w}.ktx2`, out, [job.source[0]], { width: w, height: w / 2 });
    console.log(`  ${job.key} ${w}: ${(size / 1e6).toFixed(1)} MB`);
  }
  await rm(work, { recursive: true, force: true });
}
