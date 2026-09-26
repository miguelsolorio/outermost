// Shareable deep links: the view is mirrored into the URL hash, e.g.
// #f=mars&h=2.1e6&d=0.123,-0.456,0.789&t=2026-09-25T12:00:00.000Z&r=3600

import type { Vec3 } from '../astro/vec.ts';

export interface UrlState {
  focus?: string;
  altitude?: number;
  dir?: Vec3;
  time?: number;
  rate?: number;
  paused?: boolean;
  settings?: Partial<{ labels: boolean; orbits: boolean; boost: boolean }>;
}

export function readUrlState(): UrlState {
  const p = new URLSearchParams(location.hash.slice(1));
  const out: UrlState = {};
  const f = p.get('f');
  if (f && /^[a-z0-9-]+$/.test(f)) out.focus = f;
  const h = Number(p.get('h'));
  if (Number.isFinite(h) && h > 0) out.altitude = h;
  const d = p.get('d')?.split(',').map(Number);
  if (d && d.length === 3 && d.every(Number.isFinite) && Math.hypot(...d) > 0) out.dir = d as Vec3;
  const t = p.get('t');
  if (t) {
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) out.time = ms;
  }
  const r = Number(p.get('r'));
  if (p.has('r') && Number.isFinite(r)) out.rate = r;
  if (p.get('p') === '1') out.paused = true;
  return out;
}

export function writeUrlState(s: Required<Omit<UrlState, 'settings'>>): void {
  const p = new URLSearchParams();
  p.set('f', s.focus);
  p.set('h', s.altitude.toPrecision(4));
  p.set('d', s.dir.map((x) => x.toFixed(4)).join(','));
  p.set('t', new Date(s.time).toISOString());
  if (s.rate !== 1) p.set('r', String(s.rate));
  if (s.paused) p.set('p', '1');
  const hash = '#' + p.toString();
  if (hash !== location.hash) history.replaceState(null, '', hash);
}
