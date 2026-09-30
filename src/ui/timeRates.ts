// Clock speeds, in simulated seconds per real second: the timeline's presets,
// and the same presets backward and forward for the cockpit's warp knob.

export const RATES = [1, 60, 3600, 86_400, 7 * 86_400, 30.4375 * 86_400, 365.25 * 86_400];

/** Fastest backward to fastest forward. */
export const LADDER = [...RATES.map((r) => -r).reverse(), ...RATES];

/** The preset nearest a rate (by ratio), on its side of zero. */
export function ladderIndex(rate: number): number {
  const mag = Math.max(Math.abs(rate), RATES[0]);
  let best = 0;
  for (let i = 1; i < RATES.length; i++) if (Math.abs(Math.log(RATES[i] / mag)) < Math.abs(Math.log(RATES[best] / mag))) best = i;
  return rate < 0 ? RATES.length - 1 - best : RATES.length + best;
}
