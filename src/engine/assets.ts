// Asset loading. Processed assets live under ASSET_BASE (default ./assets/,
// overridable with VITE_ASSET_BASE so they can move to a CDN). The manifest
// written by the pipeline lists every file with its size, hash and sources.

import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export const ASSET_BASE: string = (import.meta.env.VITE_ASSET_BASE as string | undefined) ?? './assets/';

export interface ManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
  sources: string[];
  width?: number;
  height?: number;
}

export interface Manifest {
  version: string;
  generated: string;
  files: Record<string, ManifestEntry>;
}

export class Assets {
  manifest: Manifest | null = null;
  private ktx2: KTX2Loader;
  private textures = new Map<string, Promise<THREE.Texture | null>>();
  private maxAniso: number;

  constructor(renderer: THREE.WebGLRenderer) {
    this.ktx2 = new KTX2Loader().setTranscoderPath('./vendor/basis/').detectSupport(renderer);
    this.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  async init(): Promise<void> {
    try {
      const res = await fetch(`${ASSET_BASE}manifest.json`, { cache: 'no-cache' });
      if (res.ok) this.manifest = await res.json();
    } catch {
      this.manifest = null;
    }
    if (!this.manifest) console.warn('Asset manifest not found; bodies will use flat colors. Run `npm run pipeline`.');
  }

  has(path: string): boolean {
    return !!this.manifest?.files[path];
  }

  /** Available texture widths for a body key, ascending (from files like textures/earth/4096.ktx2). */
  textureTiers(key: string): number[] {
    if (!this.manifest) return [];
    const prefix = `textures/${key}/`;
    return Object.keys(this.manifest.files)
      .filter((p) => p.startsWith(prefix) && /^\d+\.ktx2$/.test(p.slice(prefix.length)))
      .map((p) => Number(p.slice(prefix.length, -5)))
      .sort((a, b) => a - b);
  }

  texture(path: string, colorSpace: THREE.ColorSpace = THREE.SRGBColorSpace): Promise<THREE.Texture | null> {
    let p = this.textures.get(path);
    if (!p) {
      p = this.ktx2
        .loadAsync(ASSET_BASE + path)
        .then((tex) => {
          tex.colorSpace = colorSpace;
          tex.anisotropy = this.maxAniso;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
          return tex as THREE.Texture;
        })
        .catch((err) => {
          console.warn(`Failed to load ${path}`, err);
          return null;
        });
      this.textures.set(path, p);
    }
    return p;
  }

  /** Load and transcode a KTX2 file without caching or uploading it (e.g. to copy into an array texture). */
  async compressed(path: string): Promise<THREE.CompressedTexture | null> {
    try {
      return (await this.ktx2.loadAsync(ASSET_BASE + path)) as THREE.CompressedTexture;
    } catch (err) {
      console.warn(`Failed to load ${path}`, err);
      return null;
    }
  }

  /** Release a texture from GPU memory and the cache. */
  release(path: string): void {
    const p = this.textures.get(path);
    if (!p) return;
    this.textures.delete(path);
    void p.then((t) => t?.dispose());
  }

  async json<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(ASSET_BASE + path);
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  async binary(path: string): Promise<ArrayBuffer | null> {
    try {
      const res = await fetch(ASSET_BASE + path);
      return res.ok ? await res.arrayBuffer() : null;
    } catch {
      return null;
    }
  }
}
