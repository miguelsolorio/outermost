import { afterEach, describe, expect, it, vi } from 'vitest';
import { readUrlState, writeUrlState } from '../../src/engine/urlState.ts';

const at = (hash: string) => vi.stubGlobal('location', { hash });

describe('url state', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads a pinned location in degrees', () => {
    at('#f=earth&l=47.6062,-122.3321');
    expect(readUrlState()).toEqual({ focus: 'earth', location: [47.6062, -122.3321] });
  });

  it('ignores a location that is malformed or off the globe', () => {
    for (const l of ['47.6', '47.6,-122.3,5', '95,10', '10,200', 'north,west']) {
      at(`#l=${l}`);
      expect(readUrlState().location).toBeUndefined();
    }
  });

  it('keeps the location when it rewrites the hash', () => {
    at('');
    const replaceState = vi.fn();
    vi.stubGlobal('history', { replaceState });
    writeUrlState({ focus: 'earth', altitude: 2.4e7, dir: [1, 0, 0], time: Date.UTC(2026, 8, 26), rate: 1, paused: false, location: [47.6062, -122.3321] });
    expect(replaceState.mock.calls[0][2]).toContain('l=47.6062%2C-122.3321');
  });

  it('round-trips ship mode', () => {
    at('#f=mars&m=ship');
    expect(readUrlState().ship).toBe(true);
    at('#f=mars&m=orbit');
    expect(readUrlState().ship).toBeUndefined();
    at('');
    const replaceState = vi.fn();
    vi.stubGlobal('history', { replaceState });
    writeUrlState({ focus: 'mars', altitude: 1e7, dir: [1, 0, 0], time: Date.UTC(2026, 8, 26), rate: 1, paused: false, ship: true });
    expect(replaceState.mock.calls[0][2]).toContain('m=ship');
  });
});
