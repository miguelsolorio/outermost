// Flat ΛCDM cosmology with Planck 2018 parameters, as adopted by astropy's
// `Planck18` realization (Planck Collaboration 2020, A&A 641, A6, Table 2,
// TT,TE,EE+lowE+lensing+BAO): H0 = 67.66 km/s/Mpc, Ωm = 0.30966,
// T_CMB = 2.7255 K, N_eff = 3.046, one massive neutrino of 0.06 eV (as in
// astropy). Radiation is included (it matters for the distance to the
// last-scattering surface). The massive neutrino is treated as matter at all
// redshifts, a ≲ 0.1% simplification for the distances used here.

import { MPC } from './units.ts';

export const H0 = 67.66; // km/s/Mpc
export const OMEGA_M = 0.30966;
export const T_CMB = 2.7255; // K
export const N_EFF = 3.046;
export const Z_STAR = 1089.8; // redshift of last scattering (Planck 2018)

const C_KM_S = 299_792.458;
const h = H0 / 100;
/** Photon density: Ωγ h² = 2.4728e-5 (T/2.7255 K)^4. */
export const OMEGA_GAMMA = (2.4728e-5 * (T_CMB / 2.7255) ** 4) / (h * h);
/** Two massless neutrino species (of N_eff) as radiation: Ωr = Ωγ (1 + 0.2271 · N_eff · 2/3). */
export const OMEGA_R = OMEGA_GAMMA * (1 + 0.2271 * N_EFF * (2 / 3));
/** One 0.06 eV neutrino, non-relativistic today: Ων h² = Σmν / 93.14 eV. */
export const OMEGA_NU = 0.06 / 93.14 / (h * h);
export const OMEGA_L = 1 - OMEGA_M - OMEGA_NU - OMEGA_R;

/** Hubble distance c/H0 in Mpc. */
export const D_H = C_KM_S / H0;

export const E = (z: number): number => {
  const a = 1 + z;
  return Math.sqrt((OMEGA_M + OMEGA_NU) * a ** 3 + OMEGA_R * a ** 4 + OMEGA_L);
};

/**
 * Comoving distance to redshift z (Mpc). Integrates in ln(1+z) with Simpson's
 * rule, which stays accurate out to the CMB.
 */
export function comovingDistanceMpc(z: number, steps = 4096): number {
  if (z <= 0) return 0;
  const u1 = Math.log1p(z);
  const n = steps % 2 === 0 ? steps : steps + 1;
  const hstep = u1 / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const u = i * hstep;
    const zz = Math.expm1(u);
    const f = (1 + zz) / E(zz); // dz = (1+z) du
    s += f * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  return D_H * (s * hstep) / 3;
}

export const comovingDistance = (z: number): number => comovingDistanceMpc(z) * MPC;

/** Age of the universe at redshift z (Gyr). */
export function ageGyr(z = 0, steps = 20000): number {
  // t = ∫_z^∞ dz' / ((1+z') H(z')); integrate in a = 1/(1+z).
  const aMax = 1 / (1 + z);
  const n = steps;
  const hstep = aMax / n;
  let s = 0;
  for (let i = 0; i <= n; i++) {
    const a = Math.max(i * hstep, 1e-12);
    const f = 1 / (a * E(1 / a - 1));
    s += f * (i === 0 || i === n ? 1 : i % 2 ? 4 : 2);
  }
  const hubbleTimeGyr = 977.792 / H0; // 1/H0 in Gyr for H0 in km/s/Mpc
  return (hubbleTimeGyr * s * hstep) / 3;
}

/** Comoving particle horizon (Mpc): the radius of the observable universe today. */
export const particleHorizonMpc = (): number => comovingDistanceMpc(1e8, 20000);
