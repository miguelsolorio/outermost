// Physical constants and unit conversions. All engine math is SI meters.

/** IAU 2012 Resolution B2 astronomical unit, exact. */
export const AU = 149_597_870_700;
/** IAU 2015 Resolution B2 parsec, derived from the exact AU. */
export const PC = (648_000 / Math.PI) * AU;
export const KPC = 1e3 * PC;
export const MPC = 1e6 * PC;
/** Speed of light in vacuum, exact (m/s). */
export const C = 299_792_458;
/** Julian year (s), IAU. */
export const JULIAN_YEAR = 365.25 * 86_400;
/** Light-year: distance light travels in one Julian year (IAU). */
export const LY = C * JULIAN_YEAR;
export const GLY = 1e9 * LY;
export const KM = 1_000;

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const HOUR_ANGLE = Math.PI / 12;

/** Mean obliquity of the ecliptic at J2000 (IAU 2006), 84381.406 arcsec. */
export const OBLIQUITY_J2000 = (84_381.406 / 3600) * DEG;
