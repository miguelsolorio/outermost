// Enhanced looks for the planets, in the style of NASA's color-enhanced press
// images (Viking's Mars, Voyager's Neptune, Juno's Jupiter), with animated
// atmospheres. All of it is an artistic choice, and each planet's info card
// says so. Moons and the Sun have no entry and render unchanged.

/** How a planet's atmosphere moves (see shaders/look.ts). */
export type Atmo = 'none' | 'bands' | 'clouds' | 'venus' | 'uranus' | 'neptune';
export const ATMO_ID: Record<Atmo, number> = { none: 0, bands: 1, clouds: 2, venus: 3, uranus: 4, neptune: 5 };

/**
 * Zonal wind against latitude φ, in arbitrary units (+ = east):
 * c + eq·exp(−(φ/eqWidth)²) + polar·sin²φ + alt·cos(altFreq·φ).
 * Shaped after the measured profiles; speeds on screen are exaggerated.
 */
export interface Jets {
  c?: number;
  eq?: number;
  eqWidth?: number;
  polar?: number;
  alt?: number;
  altFreq?: number;
}

export interface PlanetLook {
  /** Saturation multiplier on the surface or cloud color (1 = unchanged). */
  saturation: number;
  /** Contrast exponent around a middling albedo (1 = unchanged). */
  contrast: number;
  /** Color balance multiplier (linear). */
  gain: [number, number, number];
  /** Local contrast: unsharp mask against a blurred read of the map. */
  sharpen: number;
  /** 0-1: how much of the chroma AgX tone mapping strips is put back. */
  vivid: number;
  /** Color blended in toward the poles, at the same brightness (rgb), and its strength. */
  poleTint?: [number, number, number, number];
  /** Color of the far-away point marker (sRGB), to match the enhanced disk. */
  marker?: [number, number, number];
  atmo: Atmo;
  jets?: Jets;
  /** Longitude drift in rad/s per unit of wind. */
  flowSpeed?: number;
  /** Swirl displacement of the flowing map (rad). */
  turbulence?: number;
  /** Info-card note, badged Artistic. */
  note: string;
}

export const LOOKS: Record<string, PlanetLook> = {
  mercury: {
    saturation: 1.15,
    contrast: 1.15,
    gain: [1.05, 1.0, 0.92],
    sharpen: 0.4,
    vivid: 0.5,
    atmo: 'none',
    note: 'Color and contrast are enhanced, in the style of NASA’s processed MESSENGER images.',
  },
  venus: {
    saturation: 1,
    contrast: 1,
    gain: [1, 1, 1],
    sharpen: 0,
    vivid: 0.6,
    marker: [0.93, 0.84, 0.62],
    atmo: 'venus',
    // The cloud tops circle the planet westward in about four days, slower toward the poles.
    jets: { c: -1, polar: 0.6 },
    flowSpeed: 0.004,
    note: 'The cloud markings are procedural and animated, styled after ultraviolet images from Mariner 10 and Akatsuki. In visible light Venus is a nearly featureless cream (Limaye et al. 2018).',
  },
  earth: {
    saturation: 1.08,
    contrast: 1.05,
    gain: [1, 1, 1],
    sharpen: 0,
    vivid: 0.35,
    atmo: 'clouds',
    // Trade winds blow west in the tropics, westerlies east at mid-latitudes.
    jets: { alt: -1, altFreq: 3 },
    flowSpeed: 0.001,
    turbulence: 0.01,
    note: 'Colors are slightly enhanced, and the clouds drift and swirl for illustration. The cloud map itself is a 2002 snapshot.',
  },
  mars: {
    saturation: 1.1,
    contrast: 1.2,
    gain: [1.06, 1.0, 0.88],
    sharpen: 0.5,
    vivid: 0.25,
    marker: [0.78, 0.5, 0.3],
    atmo: 'none',
    note: 'Color and contrast are enhanced, in the style of NASA’s Viking mosaic press images.',
  },
  jupiter: {
    saturation: 1.2,
    contrast: 1.15,
    gain: [1.04, 1.0, 0.95],
    sharpen: 0.8,
    vivid: 0.35,
    poleTint: [0.62, 0.75, 1.0, 0.6],
    marker: [0.85, 0.72, 0.58],
    atmo: 'bands',
    // A prograde equatorial jet and alternating jets every ~13° of latitude.
    jets: { eq: 0.8, eqWidth: 0.12, alt: 0.9, altFreq: 14 },
    flowSpeed: 0.001,
    turbulence: 0.007,
    note: 'Color and contrast are enhanced, in the style of NASA’s Juno images. The bands flow and swirl for illustration, far faster than Jupiter’s real winds.',
  },
  saturn: {
    saturation: 1.45,
    contrast: 1.2,
    gain: [1.08, 1.0, 0.82],
    sharpen: 0.8,
    vivid: 0.6,
    marker: [0.88, 0.76, 0.52],
    atmo: 'bands',
    // A broad, fast equatorial jet and weaker alternating jets.
    jets: { eq: 1.5, eqWidth: 0.45, alt: 0.3, altFreq: 10 },
    flowSpeed: 0.001,
    turbulence: 0.005,
    note: 'Color and contrast are enhanced, in the style of Cassini’s press images. The bands flow for illustration, far faster than Saturn’s real winds.',
  },
  uranus: {
    saturation: 1,
    contrast: 1,
    gain: [1, 1, 1],
    sharpen: 0,
    vivid: 0.6,
    marker: [0.55, 0.85, 0.9],
    atmo: 'uranus',
    // Retrograde at the equator, prograde toward the poles.
    jets: { c: -0.4, polar: 1.4 },
    flowSpeed: 0.003,
    note: 'Shown in the cyan of Voyager 2’s enhanced images; the true color is paler. Bands and clouds are procedural and animated.',
  },
  neptune: {
    saturation: 1,
    contrast: 1,
    gain: [1, 1, 1],
    sharpen: 0,
    vivid: 0.9,
    marker: [0.25, 0.42, 0.9],
    atmo: 'neptune',
    // The fastest winds in the solar system: retrograde at the equator, prograde near the poles.
    jets: { c: -1, polar: 1.6 },
    flowSpeed: 0.003,
    note: 'Shown in the deep blue of Voyager 2’s enhanced 1989 images. Bands, clouds and the Great Dark Spot (gone since 1994) are procedural and animated.',
  },
};
