// Star colors: B−V color index -> effective temperature -> sRGB.
//
// Temperature: Ballesteros (2012), EPL 97, 34008:
//   T = 4600 K · (1/(0.92·(B−V) + 1.7) + 1/(0.92·(B−V) + 0.62))
// Chromaticity: a Planck blackbody at T integrated against the CIE 1931 2°
// color-matching functions (analytic fit of Wyman, Sloan & Shirley 2013,
// JCGT 2(2)), converted to linear sRGB (D65 white) and normalized so the
// brightest channel is 1. Brightness is handled separately from magnitude.

export function bvToTemperature(bv: number): number {
  const x = Math.min(2.0, Math.max(-0.4, bv));
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
}

const g = (x: number, mu: number, s1: number, s2: number) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

/** CIE 1931 2° CMFs, multi-lobe Gaussian fit (Wyman et al. 2013), λ in nm. */
export function cie1931(lambda: number): [number, number, number] {
  const x = 1.056 * g(lambda, 599.8, 37.9, 31.0) + 0.362 * g(lambda, 442.0, 16.0, 26.7) - 0.065 * g(lambda, 501.1, 20.4, 26.2);
  const y = 0.821 * g(lambda, 568.8, 46.9, 40.5) + 0.286 * g(lambda, 530.9, 16.3, 31.1);
  const z = 1.217 * g(lambda, 437.0, 11.8, 36.0) + 0.681 * g(lambda, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** Planck spectral radiance (arbitrary units) at wavelength λ (nm). */
function planck(lambdaNm: number, T: number): number {
  const l = lambdaNm * 1e-9;
  return 1 / (l ** 5 * (Math.exp(0.01438777 / (l * T)) - 1));
}

/** Linear sRGB chromaticity of a blackbody, max channel = 1. */
export function blackbodyLinearRgb(T: number): [number, number, number] {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const p = planck(l, T);
    const [x, y, z] = cie1931(l);
    X += p * x;
    Y += p * y;
    Z += p * z;
  }
  // XYZ -> linear sRGB (IEC 61966-2-1, D65).
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  // Hot stars fall slightly outside the sRGB gamut; clip negatives.
  r = Math.max(r, 0);
  gg = Math.max(gg, 0);
  b = Math.max(b, 0);
  const m = Math.max(r, gg, b);
  return [r / m, gg / m, b / m];
}

export const linearToSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * Bolometric correction BC_V(Teff) from Torres (2010), AJ 140, 1158, Table 1
 * (Flower 1996 coefficients, corrected). Gives about -0.08 for the Sun.
 */
export function bolometricCorrection(T: number): number {
  const x = Math.log10(T);
  if (x < 3.7) return -0.190537291496456e5 + 0.155144866764412e5 * x - 0.421278819301717e4 * x ** 2 + 0.381476328422343e3 * x ** 3;
  if (x < 3.9)
    return (
      -0.370510203809015e5 + 0.385672629965804e5 * x - 0.150651486316025e5 * x ** 2 + 0.261724637119416e4 * x ** 3 - 0.170623810323864e3 * x ** 4
    );
  return (
    -0.118115450538963e6 +
    0.137145973583929e6 * x -
    0.636233812100225e5 * x ** 2 +
    0.147412923562646e5 * x ** 3 -
    0.170587278406872e4 * x ** 4 +
    0.78873172180499e2 * x ** 5
  );
}
