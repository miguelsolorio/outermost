// Star streaks past the canopy at speed, radiating from where the ship is
// heading (a hyperspace nod): nothing at a crawl, stronger at boost and while
// the autopilot cruises, and a burst when the engage lever is thrown.

import type { CockpitFrame } from '../../engine/cockpit.ts';
import type { ShipGauges } from '../../engine/camera/ship.ts';
import { smoothstep } from '../../astro/vec.ts';

interface Streak {
  angle: number;
  r: number;
  speed: number;
}

const COUNT = 64;

export class Streaks {
  private ctx: CanvasRenderingContext2D | null;
  private parts: Streak[] = [];
  private burst = 0;
  private drawn = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    for (let i = 0; i < COUNT; i++) this.parts.push(this.spawn(20 + Math.random() * 600));
  }

  /** The engage lever was thrown. */
  kick(): void {
    this.burst = 1;
  }

  private spawn(r = 20 + Math.random() * 60): Streak {
    return { angle: Math.random() * Math.PI * 2, r, speed: 0.6 + Math.random() * 0.8 };
  }

  draw(f: CockpitFrame, g: ShipGauges, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.burst = Math.max(0, this.burst - dt / 0.8);
    const cruise = g.phase === 'cruising' ? smoothstep(0.5, 3, g.drift) : 0;
    const k = Math.max(smoothstep(1.5, 4, g.drift), cruise, this.burst);
    const at = f.drift ?? (this.burst > 0 ? f.nose : null);
    if (k < 0.01 || !at) {
      if (this.drawn) ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawn = false;
      return;
    }
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const W = Math.round(f.w * dpr);
    const H = Math.round(f.h * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.w, f.h);
    const far = Math.hypot(f.w, f.h);
    ctx.lineCap = 'round';
    for (const p of this.parts) {
      // Farther out, faster: the perspective of passing through a field of stars.
      p.r *= Math.exp(dt * p.speed * (0.8 + 4 * k));
      if (p.r > far) Object.assign(p, this.spawn());
      const len = p.r * (0.03 + 0.28 * k);
      // Faint near the middle, so what you're flying toward stays clear.
      const a = k * Math.min(1, (p.r - 40) / 220);
      if (a <= 0.01) continue;
      const c = Math.cos(p.angle);
      const s = Math.sin(p.angle);
      ctx.strokeStyle = `rgb(206 222 255 / ${(0.4 * a).toFixed(3)})`;
      ctx.lineWidth = 0.6 + 0.7 * k;
      ctx.beginPath();
      ctx.moveTo(at.x + c * p.r, at.y + s * p.r);
      ctx.lineTo(at.x + c * (p.r + len), at.y + s * (p.r + len));
      ctx.stroke();
    }
    this.drawn = true;
  }
}
