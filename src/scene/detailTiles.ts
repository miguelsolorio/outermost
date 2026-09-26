// Streams high-resolution detail tiles for one body into a GPU texture array.
// The global texture stays the base layer; each tile of the finest level
// (e.g. Earth L4: 32 × 16 tiles of 11.25°) is loaded only when its base texels
// would be magnified on screen, and the planet shader looks tiles up through a
// small index texture (one texel per tile: layer, which month, present).
//
// Tile images carry a gutter of neighbor pixels (see tools/pipeline/steps/
// tiles.ts), so bilinear filtering and the first mip levels stay seamless.

import * as THREE from 'three';
import type { Mat3, Vec3 } from '../astro/vec.ts';
import type { Assets } from '../engine/assets.ts';

const getByteLength = THREE.TextureUtils.getByteLength;

interface TileIndex {
  tile: number;
  gutter: number;
  levels: Record<string, { nx: number; ny: number; bytes: number[] }>;
}

interface Layer {
  /** "set/x_y" held by this layer, or null. */
  key: string | null;
  set: string;
  x: number;
  y: number;
  lastUsed: number;
}

export interface DetailRequest {
  /** Tile set to load (e.g. the month nearest the current date). */
  set: string;
  /** Sets the shader can currently use, by index (0 = map, 1 = map2). */
  usable: string[];
  /** Body-fixed → EQJ rotation (row-major). */
  orient: Mat3;
  /** Camera position relative to the body center, EQJ (m). */
  camRel: Vec3;
  /** Unit view direction, EQJ. */
  viewDir: Vec3;
  /** Half the diagonal field of view (rad). */
  halfDiag: number;
  pxPerRad: number;
  radius: number;
  /** Width of the global base texture (px). */
  baseWidth: number;
  frame: number;
}

export class DetailTiles {
  readonly uniforms = {
    detailTex: { value: null as THREE.CompressedArrayTexture | null },
    detailIndex: { value: null as THREE.DataTexture | null },
    hasDetail: { value: false },
    detailGrid: { value: new THREE.Vector2(1, 1) },
    /** Content fraction of a tile and the gutter offset, in tile units. */
    detailFrame: { value: new THREE.Vector2(1, 0) },
  };
  private index: TileIndex | null = null;
  private nx = 0;
  private ny = 0;
  private level = 0;
  private layers: Layer[] = [];
  private loading = new Set<string>();
  private indexData: Uint8Array | null = null;
  private tex: THREE.CompressedArrayTexture | null = null;
  private failed = new Set<string>();
  /** Tile centers as unit vectors in the body-fixed frame. */
  private centers: Float64Array | null = null;
  private tileRadius: Float64Array | null = null;
  private lastSets = '';

  constructor(
    private assets: Assets,
    /** Path prefix of a tile set, e.g. set => `tiles/${set}`. */
    private indexSet: string,
    private capacity = 48,
    private maxConcurrent = 6,
  ) {}

  async init(): Promise<boolean> {
    if (!this.assets.has(`tiles/${this.indexSet}/index.json`)) return false;
    const index = await this.assets.json<TileIndex>(`tiles/${this.indexSet}/index.json`);
    if (!index) return false;
    this.index = index;
    this.level = Math.max(...Object.keys(index.levels).map(Number));
    const { nx, ny } = index.levels[this.level];
    this.nx = nx;
    this.ny = ny;
    const size = index.tile + 2 * index.gutter;
    this.uniforms.detailGrid.value.set(nx, ny);
    this.uniforms.detailFrame.value.set(index.tile / size, index.gutter / size);
    this.indexData = new Uint8Array(nx * ny * 4);
    const it = new THREE.DataTexture(this.indexData, nx, ny, THREE.RGBAFormat, THREE.UnsignedByteType);
    it.minFilter = THREE.NearestFilter;
    it.magFilter = THREE.NearestFilter;
    it.generateMipmaps = false;
    it.needsUpdate = true;
    this.uniforms.detailIndex.value = it;
    this.centers = new Float64Array(nx * ny * 3);
    this.tileRadius = new Float64Array(nx * ny);
    const dLon = (2 * Math.PI) / nx;
    const dLat = Math.PI / ny;
    for (let y = 0; y < ny; y++) {
      const lat = Math.PI / 2 - (y + 0.5) * dLat;
      for (let x = 0; x < nx; x++) {
        const lon = -Math.PI + (x + 0.5) * dLon;
        const i = y * nx + x;
        this.centers.set([Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)], i * 3);
        // Angular radius: half-diagonal, using the wider (equatorward) edge.
        const wide = Math.cos(Math.max(0, Math.abs(lat) - dLat / 2));
        this.tileRadius[i] = 0.5 * Math.hypot(dLon * wide, dLat);
      }
    }
    for (let i = 0; i < this.capacity; i++) this.layers.push({ key: null, set: '', x: 0, y: 0, lastUsed: -1 });
    return true;
  }

  get ready(): boolean {
    return !!this.index;
  }

  update(req: DetailRequest): void {
    if (!this.index || !this.centers || !this.tileRadius) return;
    const m = req.orient;
    const c = req.camRel;
    const v = req.viewDir;
    // Camera position and view direction in the body-fixed frame (Mᵀ·x).
    const P: Vec3 = [m[0] * c[0] + m[3] * c[1] + m[6] * c[2], m[1] * c[0] + m[4] * c[1] + m[7] * c[2], m[2] * c[0] + m[5] * c[1] + m[8] * c[2]];
    const V: Vec3 = [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];
    const dist = Math.hypot(P[0], P[1], P[2]);
    const R = req.radius;
    const Pn: Vec3 = [P[0] / dist, P[1] / dist, P[2] / dist];
    const horizon = Math.acos(Math.min(1, R / dist));
    const baseTexel = (2 * Math.PI * R) / req.baseWidth;

    // Rank tiles by how magnified the base texture would be on screen.
    const wanted: Array<{ i: number; px: number }> = [];
    for (let i = 0; i < this.nx * this.ny; i++) {
      const cx = this.centers[i * 3];
      const cy = this.centers[i * 3 + 1];
      const cz = this.centers[i * 3 + 2];
      const rad = this.tileRadius[i];
      const ang = Math.acos(Math.max(-1, Math.min(1, cx * Pn[0] + cy * Pn[1] + cz * Pn[2])));
      if (ang > horizon + rad) continue;
      // Direction from the camera to the tile center, and its angular size.
      const tx = cx * R - P[0];
      const ty = cy * R - P[1];
      const tz = cz * R - P[2];
      const td = Math.hypot(tx, ty, tz);
      const angSize = Math.asin(Math.min(1, (rad * R) / td));
      const off = Math.acos(Math.max(-1, Math.min(1, (tx * V[0] + ty * V[1] + tz * V[2]) / td)));
      if (off > req.halfDiag + angSize) continue;
      // Nearest point of the tile: never closer than the altitude.
      const near = Math.max(dist - R, td - rad * R);
      const px = (baseTexel / near) * req.pxPerRad;
      if (px > 0.7) wanted.push({ i, px });
    }
    wanted.sort((a, b) => b.px - a.px);
    if (wanted.length > this.capacity) wanted.length = this.capacity;

    const holding = new Map<string, Layer>();
    for (const l of this.layers) if (l.key) holding.set(l.key, l);
    const keep = new Set<Layer>();
    const toLoad: Array<{ x: number; y: number }> = [];
    for (const { i } of wanted) {
      const x = i % this.nx;
      const y = Math.floor(i / this.nx);
      const exact = holding.get(`${req.set}/${x}_${y}`);
      if (exact) {
        exact.lastUsed = req.frame;
        keep.add(exact);
        continue;
      }
      toLoad.push({ x, y });
      // Meanwhile keep showing the same tile from another usable month.
      for (const s of req.usable) {
        const alt = holding.get(`${s}/${x}_${y}`);
        if (alt) {
          alt.lastUsed = req.frame;
          keep.add(alt);
        }
      }
    }
    for (const { x, y } of toLoad) {
      if (this.loading.size >= this.maxConcurrent) break;
      const key = `${req.set}/${x}_${y}`;
      if (this.loading.has(key) || this.failed.has(key)) continue;
      // Evict the least recently used layer that isn't needed this frame.
      let victim: Layer | null = null;
      for (const l of this.layers) {
        if (keep.has(l) || (l.key && this.loading.has(l.key))) continue;
        if (!victim || l.lastUsed < victim.lastUsed) victim = l;
      }
      if (!victim) break;
      keep.add(victim);
      this.load(victim, req.set, x, y, req.frame);
    }

    // Rebuild the index when the usable sets change or layers moved.
    const sets = req.usable.join(',');
    if (sets !== this.lastSets) {
      this.lastSets = sets;
      this.writeIndex(req.usable);
    }
  }

  private usable: string[] = [];

  private writeIndex(usable: string[]): void {
    this.usable = usable;
    const d = this.indexData;
    const it = this.uniforms.detailIndex.value;
    if (!d || !it) return;
    d.fill(0);
    let any = false;
    this.layers.forEach((l, layer) => {
      if (!l.key) return;
      const which = usable.indexOf(l.set);
      if (which < 0) return;
      const o = (l.y * this.nx + l.x) * 4;
      // Prefer the tile matching map (0) when both months are present.
      if (d[o + 3] && d[o + 1] === 0) return;
      d[o] = layer;
      d[o + 1] = which * 255;
      d[o + 3] = 255;
      any = true;
    });
    it.needsUpdate = true;
    this.uniforms.hasDetail.value = any && !!this.tex;
  }

  private load(layer: Layer, set: string, x: number, y: number, frame: number): void {
    const key = `${set}/${x}_${y}`;
    this.loading.add(key);
    const prevKey = layer.key;
    // Unmap the layer right away so the shader never shows stale content.
    layer.key = null;
    if (prevKey) this.writeIndex(this.usable);
    layer.lastUsed = frame;
    void this.assets
      .compressed(`tiles/${set}/${this.level}/${x}_${y}.ktx2`)
      .then((t) => {
        this.loading.delete(key);
        if (!t) {
          this.failed.add(key);
          return;
        }
        const idx = this.layers.indexOf(layer);
        if (!this.copyIn(t, idx)) return;
        layer.key = key;
        layer.set = set;
        layer.x = x;
        layer.y = y;
        this.writeIndex(this.usable);
      });
  }

  /** Copy a transcoded tile's mip chain into array layer `idx`. */
  private copyIn(t: THREE.CompressedTexture, idx: number): boolean {
    const mips = t.mipmaps as Array<{ data: Uint8Array; width: number; height: number }>;
    if (!this.tex) {
      const arrMips = mips.map((mp) => ({
        data: new Uint8Array(getByteLength(mp.width, mp.height, t.format, t.type) * this.capacity),
        width: mp.width,
        height: mp.height,
      }));
      const tex = new THREE.CompressedArrayTexture(arrMips as unknown as ImageData[], mips[0].width, mips[0].height, this.capacity, t.format as THREE.CompressedPixelFormat, t.type);
      tex.colorSpace = t.colorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = 8;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      this.tex = tex;
      this.uniforms.detailTex.value = tex;
    }
    const tex = this.tex;
    const dst = tex.mipmaps as unknown as Array<{ data: Uint8Array; width: number; height: number }>;
    if (t.format !== tex.format || mips.length !== dst.length || mips[0].width !== dst[0].width) {
      console.warn('detail tile format mismatch');
      return false;
    }
    for (let i = 0; i < mips.length; i++) {
      const n = getByteLength(dst[i].width, dst[i].height, tex.format, tex.type);
      dst[i].data.set(mips[i].data.subarray(0, n), idx * n);
    }
    tex.addLayerUpdate(idx);
    tex.needsUpdate = true;
    return true;
  }

  /** Number of layers currently mapped (for debugging). */
  get loaded(): number {
    return this.layers.filter((l) => l.key).length;
  }
}
