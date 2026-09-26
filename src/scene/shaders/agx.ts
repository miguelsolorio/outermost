// AgX tone mapping (engine/renderer.ts) mixes the color channels before its
// log curve (sRGB → Rec.2020 → AgX inset), so saturated colors come out
// washed: pure red lands on salmon. Mapping a color back through the inverse
// of that mix keeps its chroma on screen. White is unchanged, and some
// channels can go negative, which come out near zero after tone mapping.

export const agxChunk = /* glsl */ `
const mat3 AGX_INSET_INV = mat3(
  2.11451, -0.37054, -0.16595,
  -1.02747, 1.55299, -0.25469,
  -0.08711, -0.18233, 1.42063);
// k = 0 leaves c as is; k = 1 shows it as saturated as its linear values say.
vec3 agxVivid(vec3 c, float k) {
  return mix(c, AGX_INSET_INV * c, k);
}
`;
