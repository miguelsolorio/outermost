// Solar limb darkening, I(μ)/I(1) = Σ a_k μ^k, from Neckel & Labs (1994),
// Solar Physics 153, 91, Table I. Wavelengths chosen near the sRGB primaries.
// (Coefficients transcribed from the ADS scan; each row sums to 1.)
export const SUN_LIMB = {
  source: 'Neckel & Labs 1994, Sol. Phys. 153, 91, Table I',
  // 640.970 nm
  r: [0.33644, 1.3059, -1.79238, 2.4504, -1.89979, 0.59943],
  // 541.760 nm
  g: [0.26073, 1.27428, -1.30352, 1.47085, -0.96618, 0.26384],
  // 457.345 nm
  b: [0.16604, 1.38544, -1.52275, 2.00232, -1.45969, 0.42864],
};
