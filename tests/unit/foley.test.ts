import { describe, expect, it } from 'vitest';
import { humParams } from '../../src/audio/foley.ts';

describe('engine hum', () => {
  it('idles quietly and rises with the drift', () => {
    const idle = humParams(0);
    expect(idle.gain).toBeGreaterThan(0);
    expect(idle.rush).toBe(0);
    let last = idle;
    for (const drift of [0.2, 1, 2, 4, 5]) {
      const p = humParams(drift);
      expect(p.gain).toBeGreaterThan(last.gain);
      expect(p.pitch).toBeGreaterThan(last.pitch);
      expect(p.cutoff).toBeGreaterThan(last.cutoff);
      last = p;
    }
    // Reverse hums like forward, and it levels off past the autopilot's top speed.
    expect(humParams(-1)).toEqual(humParams(1));
    expect(humParams(50)).toEqual(humParams(5));
  });
});
