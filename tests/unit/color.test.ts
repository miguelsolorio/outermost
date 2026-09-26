import { describe, expect, it } from 'vitest';
import { blackbodyLinearRgb, bolometricCorrection, bvToTemperature } from '../../src/astro/color.ts';

describe('B−V to temperature (Ballesteros 2012)', () => {
  it('Sun (B−V 0.65) ≈ 5800 K', () => expect(bvToTemperature(0.65)).toBeGreaterThan(5600));
  it('Sun upper bound', () => expect(bvToTemperature(0.65)).toBeLessThan(6000));
  it('Vega (B−V 0.0) ≈ 10,000 K', () => expect(Math.abs(bvToTemperature(0.0) - 10000)).toBeLessThan(500));
  it('Betelgeuse (B−V 1.85) is cool', () => expect(bvToTemperature(1.85)).toBeLessThan(3700));
});

describe('blackbody colors', () => {
  it('hot stars are blue-white, cool stars orange-red', () => {
    const hot = blackbodyLinearRgb(20000);
    const cool = blackbodyLinearRgb(3200);
    expect(hot[2]).toBeGreaterThan(hot[0]);
    expect(cool[0]).toBeGreaterThan(cool[2] * 3);
  });
  it('6500 K is near the sRGB (D65) white point', () => {
    const [r, g, b] = blackbodyLinearRgb(6504);
    expect(Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b))).toBeLessThan(0.08);
  });
});

describe('bolometric correction (Torres 2010)', () => {
  it('the Sun is about -0.08 (IAU: M_bol 4.74, M_V 4.83)', () => expect(Math.abs(bolometricCorrection(5772) + 0.08)).toBeLessThan(0.03));
  it('cool and hot stars have large negative corrections', () => {
    expect(bolometricCorrection(3500)).toBeLessThan(-2);
    expect(bolometricCorrection(30000)).toBeLessThan(-2.5);
  });
});
