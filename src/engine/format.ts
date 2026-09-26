// Human-readable distances and times.

import { AU, GLY, KM, LY, PC } from '../astro/units.ts';

const nf = (digits: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function formatDistance(m: number): string {
  const abs = Math.abs(m);
  if (abs < 1_000) return `${nf(0).format(m)} m`;
  if (abs < 1e9) return `${nf(abs < 1e4 ? 1 : 0).format(m / KM)} km`;
  if (abs < 0.1 * AU) return `${nf(2).format(m / 1e9)} million km`;
  if (abs < 0.1 * LY) {
    const au = m / AU;
    return `${nf(au < 10 ? 2 : au < 1000 ? 1 : 0).format(au)} AU`;
  }
  if (abs < 1e6 * LY) {
    const ly = m / LY;
    return `${nf(ly < 10 ? 2 : ly < 100 ? 1 : 0).format(ly)} light-years`;
  }
  if (abs < 1e9 * LY) return `${nf(1).format(m / (1e6 * LY))} million light-years`;
  return `${nf(2).format(m / GLY)} billion light-years`;
}

/** Compact form for tight spaces, e.g. "4.37 ly", "2.5 Mly", "56.44M km". */
export function formatDistanceShort(m: number): string {
  return formatDistance(m)
    .replace(' million light-years', ' Mly')
    .replace(' billion light-years', ' Gly')
    .replace(' light-years', ' ly')
    .replace(' million km', 'M km');
}

export function formatParsec(m: number): string {
  return `${nf(2).format(m / PC)} pc`;
}

export function formatRate(rate: number): string {
  const a = Math.abs(rate);
  const sign = rate < 0 ? '−' : '';
  if (a === 0) return 'paused';
  if (a === 1) return rate < 0 ? 'reverse real time' : 'real time';
  const units: Array<[number, string]> = [
    [365.25 * 86_400, 'yr'],
    [30.4375 * 86_400, 'mo'],
    [7 * 86_400, 'wk'],
    [86_400, 'day'],
    [3_600, 'hr'],
    [60, 'min'],
    [1, 's'],
  ];
  for (const [s, name] of units) {
    if (a >= s) return `${sign}${nf(1).format(a / s)} ${name}/s`;
  }
  return `${sign}${a}×`;
}
