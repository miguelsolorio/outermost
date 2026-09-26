// DOM labels with greedy priority-based decluttering and float64 ray-sphere
// occlusion against nearer bodies.

import * as THREE from 'three';
import type { Vec3 } from '../astro/vec.ts';

export interface LabelItem {
  id: string;
  text: string;
  /** Higher wins when labels overlap. */
  priority: number;
  /** Camera-relative position (m). */
  pos: Vec3;
  /** Pixels to offset the label to the right of the anchor (e.g. the disk radius). */
  offsetPx: number;
  kind: string;
  alpha: number;
  focused?: boolean;
}

export interface Occluder {
  id: string;
  center: Vec3;
  radius: number;
}

interface Placed {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const v = new THREE.Vector3();

export class LabelLayer {
  private els = new Map<string, HTMLElement>();
  visibleIds = new Set<string>();

  constructor(
    private root: HTMLElement,
    private onClick: (id: string) => void,
    private onHover?: (id: string | null) => void,
  ) {}

  private element(item: LabelItem): HTMLElement {
    let el = this.els.get(item.id);
    if (!el) {
      const btn = document.createElement('button');
      btn.type = 'button';
      el = btn;
      el.className = `label label-${item.kind}`;
      el.textContent = item.text;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onClick(item.id);
      });
      el.addEventListener('pointerenter', () => this.onHover?.(item.id));
      el.addEventListener('pointerleave', () => this.onHover?.(null));
      this.root.appendChild(el);
      this.els.set(item.id, el);
    }
    return el;
  }

  update(items: LabelItem[], camera: THREE.PerspectiveCamera, w: number, h: number, occluders: Occluder[], enabled: boolean): void {
    const sorted = [...items].sort((a, b) => b.priority - a.priority);
    const placed: Placed[] = [];
    const seen = new Set<string>();
    this.visibleIds.clear();
    for (const item of sorted) {
      const el = this.element(item);
      seen.add(item.id);
      const show = (enabled || item.focused) && item.alpha > 0.02 && this.project(item, camera, w, h);
      if (!show || this.occluded(item, occluders)) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }
      const x = v.x + item.offsetPx + 6;
      const y = v.y;
      const width = item.text.length * 7 + 10;
      const rect = { x0: x - 2, y0: y - 9, x1: x + width, y1: y + 9 };
      if (!item.focused && placed.some((p) => rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0)) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }
      placed.push(rect);
      this.visibleIds.add(item.id);
      el.style.transform = `translate(${x.toFixed(1)}px, ${(y - 8).toFixed(1)}px)`;
      el.style.opacity = String(Math.min(1, item.alpha));
      el.style.pointerEvents = 'auto';
      el.classList.toggle('focused', !!item.focused);
    }
    for (const [id, el] of this.els) {
      if (!seen.has(id)) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
    }
  }

  /** Projects into `v` as CSS pixels; false if behind the camera or off-screen. */
  private project(item: LabelItem, camera: THREE.PerspectiveCamera, w: number, h: number): boolean {
    v.set(item.pos[0], item.pos[1], item.pos[2]).applyMatrix4(camera.matrixWorldInverse);
    if (v.z >= 0) return false;
    v.applyMatrix4(camera.projectionMatrix);
    v.x = (v.x * 0.5 + 0.5) * w;
    v.y = (-v.y * 0.5 + 0.5) * h;
    return v.x > -50 && v.x < w + 50 && v.y > -20 && v.y < h + 20;
  }

  private occluded(item: LabelItem, occluders: Occluder[]): boolean {
    const p = item.pos;
    const d = Math.hypot(p[0], p[1], p[2]);
    const dx = p[0] / d;
    const dy = p[1] / d;
    const dz = p[2] / d;
    for (const o of occluders) {
      if (o.id === item.id) continue;
      const t = o.center[0] * dx + o.center[1] * dy + o.center[2] * dz;
      if (t <= 0 || t >= d) continue;
      const cx = o.center[0] - t * dx;
      const cy = o.center[1] - t * dy;
      const cz = o.center[2] - t * dz;
      if (cx * cx + cy * cy + cz * cz < o.radius * o.radius) return true;
    }
    return false;
  }
}
