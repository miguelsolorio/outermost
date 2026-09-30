import { describe, expect, it } from 'vitest';
import { attitude, LEVER_DETENTS, leverDetent, leverDrift, leverPos, radarBlip, RADAR_FAR, RADAR_NEAR, subPoint } from '../../src/engine/instruments.ts';
import { normalize, rotateAxisAngle, type Vec3 } from '../../src/astro/vec.ts';

const DEG = Math.PI / 180;
const fwd: Vec3 = [0, 1, 0];
const up: Vec3 = [0, 0, 1];
const level: Vec3 = [0, 0, 1];

describe('attitude', () => {
  it('reads level flight as zero', () => {
    const a = attitude(fwd, up, level);
    expect(a.pitch).toBeCloseTo(0, 12);
    expect(a.bank).toBeCloseTo(0, 12);
  });

  it('reads pitch and bank', () => {
    const right: Vec3 = [1, 0, 0];
    // Nose 10° up.
    const f = rotateAxisAngle(fwd, right, 10 * DEG);
    const u = rotateAxisAngle(up, right, 10 * DEG);
    expect(attitude(f, u, level).pitch).toBeCloseTo(10 * DEG, 9);
    // Right wing 20° down: up leans right.
    const b = rotateAxisAngle(up, fwd, 20 * DEG);
    expect(b[0]).toBeGreaterThan(0);
    expect(attitude(fwd, b, level).bank).toBeCloseTo(20 * DEG, 9);
  });

  it('stays finite with the nose straight up', () => {
    const a = attitude([0, 0, 1], [0, -1, 0], level);
    expect(a.pitch).toBeCloseTo(90 * DEG, 9);
    expect(a.bank).toBe(0);
  });
});

describe('radar', () => {
  it('puts ahead at the top, right at the right and behind at the bottom', () => {
    const P = 1e6;
    const ahead = radarBlip([0, 1e8, 0], fwd, up, P);
    expect(ahead.x).toBeCloseTo(0, 9);
    expect(ahead.y).toBeLessThan(0);
    const right = radarBlip([1e8, 0, 0], fwd, up, P);
    expect(right.x).toBeGreaterThan(0);
    expect(right.y).toBeCloseTo(0, 9);
    expect(radarBlip([0, -1e8, 0], fwd, up, P).y).toBeGreaterThan(0);
    expect(radarBlip([0, 1e8, 1e8], fwd, up, P).el).toBeCloseTo(45 * DEG, 9);
  });

  it('spans its range in log distance and pins far contacts to the rim', () => {
    const P = 1e6;
    expect(radarBlip([0, RADAR_NEAR * P, 0], fwd, up, P).y).toBeCloseTo(0, 9);
    const rim = radarBlip([0, RADAR_FAR * P, 0], fwd, up, P);
    expect(rim.y).toBeCloseTo(-1, 9);
    expect(rim.clipped).toBe(false);
    const past = radarBlip([0, 1e3 * RADAR_FAR * P, 0], fwd, up, P);
    expect(past.y).toBeCloseTo(-1, 9);
    expect(past.clipped).toBe(true);
  });
});

describe('sub-ship point', () => {
  const pole: Vec3 = [0, 0, 1];
  const sun: Vec3 = [1, 0, 0];
  it('is noon at the equator over the subsolar point', () => {
    const p = subPoint([7e6, 0, 0], pole, sun);
    expect(p.lat).toBeCloseTo(0, 9);
    expect(p.lon).toBeCloseTo(0, 9);
  });
  it('finds the pole and the east', () => {
    expect(subPoint([0, 0, 7e6], pole, sun).lat).toBeCloseTo(90, 9);
    expect(subPoint([0, 7e6, 0], pole, sun).lon).toBeCloseTo(90, 9);
    expect(Math.abs(subPoint(normalize([-1, 0, 0]), pole, sun).lon)).toBeCloseTo(180, 9);
  });
});

describe('throttle lever travel', () => {
  it('hits every detent exactly', () => {
    for (const d of LEVER_DETENTS) {
      expect(leverDrift(d.pos)).toBeCloseTo(d.drift, 12);
      expect(leverPos(d.drift)).toBeCloseTo(d.pos, 12);
    }
  });

  it('round-trips and rises monotonically', () => {
    let last = -Infinity;
    for (let i = 0; i <= 200; i++) {
      const p = i / 200;
      const u = leverDrift(p);
      expect(u).toBeGreaterThan(last);
      expect(leverPos(u)).toBeCloseTo(p, 9);
      last = u;
    }
  });

  it('snaps into a nearby detent only', () => {
    expect(leverDetent(0.69)?.name).toBe('Cruise');
    expect(leverDetent(0.55)).toBe(null);
  });
});

describe('warp ladder', () => {
  it('finds the preset nearest a rate, on its side of zero', async () => {
    const { LADDER, ladderIndex } = await import('../../src/ui/timeRates.ts');
    expect(LADDER[ladderIndex(1)]).toBe(1);
    expect(LADDER[ladderIndex(-1)]).toBe(-1);
    expect(LADDER[ladderIndex(100)]).toBe(60);
    expect(LADDER[ladderIndex(0)]).toBe(1);
    expect(ladderIndex(1e12)).toBe(LADDER.length - 1);
    expect(ladderIndex(-1e12)).toBe(0);
  });
});
