import { describe, expect, it } from 'vitest';
import { flightDuration, glide, settleCurve, zoomPath } from '../../src/engine/camera/path.ts';

const FOV = (45 * Math.PI) / 180;
const AU = 1.496e11;
const RS = [1e3, 1e6, 3e9, 1e20, 1e27];
const DS = [0, 1e-3, 1e5, AU, 1e26];

/** Framing distance for a sphere of radius R (as CameraController.framingDistance). */
const frame = (R: number) => R / Math.sin(FOV * 0.3);

describe('zoom path', () => {
  it('starts and ends exactly', () => {
    for (const r0 of RS)
      for (const r1 of RS)
        for (const d of DS) {
          const p = zoomPath(r0, r1, d, FOV);
          const a = p.at(0);
          const b = p.at(p.L);
          expect(a.f).toBe(0);
          expect(b.g).toBe(0);
          expect(Math.abs(a.lnR - Math.log(r0))).toBeLessThan(1e-12 * Math.max(1, Math.abs(Math.log(r0))));
          expect(Math.abs(b.lnR - Math.log(r1))).toBeLessThan(1e-12 * Math.max(1, Math.abs(Math.log(r1))));
        }
  });

  it('is finite, monotone and consistent at every scale', () => {
    for (const r0 of RS)
      for (const r1 of RS)
        for (const d of DS) {
          const p = zoomPath(r0, r1, d, FOV);
          expect(Number.isFinite(p.S) && Number.isFinite(p.L)).toBe(true);
          let prev = -1;
          for (let i = 0; i <= 200; i++) {
            const { f, g, lnR } = p.at((p.L * i) / 200);
            expect(Number.isFinite(f) && Number.isFinite(g) && Number.isFinite(lnR)).toBe(true);
            expect(Math.abs(f + g - 1)).toBeLessThan(1e-12);
            expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
            // Never closer than the nearer end.
            expect(lnR).toBeGreaterThan(Math.min(Math.log(r0), Math.log(r1)) - 1e-9);
            prev = f;
          }
        }
  });

  it('pulls back between distant bodies, about as far as the old hump', () => {
    const p = zoomPath(frame(6.371e6), frame(3.39e6), 1.5 * AU, FOV);
    let peak = 0;
    for (let i = 0; i <= 400; i++) peak = Math.max(peak, p.at((p.L * i) / 400).lnR);
    expect(Math.exp(peak)).toBeGreaterThan(0.3 * AU);
    expect(Math.exp(peak)).toBeLessThan(3 * AU);
  });

  it('keeps pan and zoom in step: the pan never outruns the view', () => {
    // Earth → the observable universe is a 1 AU pan out of a 3e7 m view:
    // it must not be treated as a pure zoom (which pans linearly while close in).
    for (const [r0, r1, d] of [
      [frame(6.371e6), 1.05e27, AU],
      [frame(6.371e6), frame(3.39e6), 1.5 * AU],
      [5 * AU, 110 * 2.66e4, 7.4e19],
    ]) {
      const p = zoomPath(r0, r1, d, FOV);
      const n = 2000;
      for (let i = 0; i < n; i++) {
        const a = p.at((p.L * i) / n);
        const b = p.at((p.L * (i + 1)) / n);
        // Pan per step, in units of the view distance, relative to the step in log distance.
        const pan = (Math.abs(b.f - a.f) * d) / Math.exp(Math.min(a.lnR, b.lnR));
        expect(pan).toBeLessThan((10 * p.L) / n);
      }
    }
  });
});

describe('glide easing', () => {
  it('runs 0 → 1, monotone, starting and stopping at rest', () => {
    expect(glide(0)).toBe(0);
    expect(glide(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 1000; i++) {
      const y = glide(i / 1000);
      expect(y).toBeGreaterThanOrEqual(prev);
      prev = y;
    }
    const h = 1e-6;
    expect(glide(h) / h).toBeLessThan(1e-6);
    expect((1 - glide(1 - h)) / h).toBeLessThan(1e-6);
  });

  it('can start already at cruising speed', () => {
    expect(glide(0, 0)).toBe(0);
    expect(glide(1, 0)).toBe(1);
    expect(glide(0.01, 0) / 0.01).toBeCloseTo(1 / 0.8, 6);
  });

  it('has a continuous speed, peaking at about 1.5× average', () => {
    const h = 1e-5;
    const speed = (t: number) => (glide(t + h) - glide(t - h)) / (2 * h);
    for (const t of [0.25, 0.6]) expect(Math.abs(speed(t - 1e-4) - speed(t + 1e-4))).toBeLessThan(1e-3);
    let top = 0;
    for (let i = 1; i < 1000; i++) top = Math.max(top, speed(i / 1000));
    expect(top).toBeGreaterThan(1.4);
    expect(top).toBeLessThan(1.55);
  });
});

describe('settle curve', () => {
  it('starts at the offset and velocity, and comes to rest at zero', () => {
    const T = 0.5;
    const h = 1e-6;
    expect(settleCurve(2, 3, 0, T)).toBe(2);
    expect((settleCurve(2, 3, h, T) - settleCurve(2, 3, 0, T)) / (h * T)).toBeCloseTo(3, 4);
    expect(settleCurve(2, 3, 1, T)).toBe(0);
    expect(Math.abs(settleCurve(2, 3, 1 - h, T)) / h).toBeLessThan(1e-3);
  });
});

describe('flight duration', () => {
  const trip = (r0: number, r1: number, d: number, swing = 0) => flightDuration(zoomPath(r0, r1, d, FOV).S, swing);
  const earth = frame(6.371e6);

  it('scales with the trip', () => {
    const moon = trip(earth, frame(1.737e6), 3.84e8);
    const mars = trip(earth, frame(3.39e6), 1.5 * AU);
    const v404 = trip(5 * AU, 110 * 2.66e4, 7.4e19);
    expect(moon).toBeGreaterThan(1.7);
    expect(moon).toBeLessThan(2.4);
    expect(mars).toBeGreaterThan(3);
    expect(mars).toBeLessThan(3.8);
    expect(v404).toBeGreaterThan(6.4);
    expect(v404).toBeLessThan(7.6);
    expect(moon).toBeLessThan(mars);
    expect(mars).toBeLessThan(v404);
  });

  it('stays within 1.6–8 s', () => {
    for (const r0 of RS) for (const r1 of RS) for (const d of DS) for (const swing of [0, Math.PI]) {
      const T = trip(r0, r1, d, swing);
      expect(T).toBeGreaterThanOrEqual(1.6);
      expect(T).toBeLessThanOrEqual(8);
    }
  });
});
