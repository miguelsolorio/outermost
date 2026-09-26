// Bakes Saturn's ring normal optical depth profile from the Voyager 2 PPS
// delta Scorpii stellar occultation (PDS Ring-Moon Systems Node, 10 km bins).
// Columns: radius (km), mean signal, uncertainty, normal opacity τ, τ lower, τ upper.
// Opaque bins (upper limit 99) are clamped; unconstrained bins interpolated.

import { fetchText, today, writeJson } from './util.ts';

const URL = 'https://pds-rings.seti.org/holdings/volumes/VG_28xx/VG_2801/EASYDATA/KM010/PS1P01.TAB';
const TAU_MAX = 5;

export async function bakeRings(outPath: string): Promise<void> {
  const rows = (await fetchText(URL))
    .split('\n')
    .map((l) => l.split(',').map((x) => Number(x.trim())))
    .filter((c) => c.length >= 6 && Number.isFinite(c[0]));
  const r0 = rows[0][0];
  const step = rows[1][0] - rows[0][0];
  const tau: (number | null)[] = rows.map(([, , , t, lo, hi]) => {
    if (hi >= 99) return TAU_MAX; // opaque to the PPS: at least this thick
    if (lo <= -9) return null; // unconstrained
    return Math.min(TAU_MAX, Math.max(0, t));
  });
  // Fill unconstrained gaps linearly.
  for (let i = 0; i < tau.length; i++) {
    if (tau[i] !== null) continue;
    let j = i;
    while (j < tau.length && tau[j] === null) j++;
    const a = i > 0 ? (tau[i - 1] as number) : 0;
    const b = j < tau.length ? (tau[j] as number) : 0;
    for (let k = i; k < j; k++) tau[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  await writeJson(outPath, {
    source: 'Voyager 2 PPS delta Scorpii occultation, 1981-08-26 (Esposito et al.); PDS Ring-Moon Systems Node VG_2801',
    url: URL,
    license: 'Public domain (NASA PDS)',
    retrieved: today(),
    wavelength_um: 0.264,
    radius0_km: r0,
    step_km: step,
    tau_max_clamp: TAU_MAX,
    tau: (tau as number[]).map((t) => Math.round(t * 1000) / 1000),
  });
  console.log(`  rings: ${tau.length} samples from ${r0} km every ${step} km`);
}
