// Declarative list of texture jobs. Longitude/latitude conventions for each
// source were read from its own metadata (GeoTIFF tie points, FITS header, or
// README) and are noted inline.

import type { TileSetJob } from './steps/tiles.ts';
import type { TextureJob } from './steps/textures.ts';

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

export const TEXTURE_JOBS: TextureJob[] = [
  // NASA SVS CGI Moon Kit: equirectangular, 0° longitude at center, east right.
  { key: 'moon', source: ['svs-cgi-moon-kit', 'lroc_color_poles_16k.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },

  // USGS GeoTIFF tie point x = -10,669,900 m = -180°: longitude -180..180, east right.
  { key: 'mars', source: ['usgs-mars-viking-color', 'Mars_Viking_ClrMosaic_global_925m.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },

  // USGS GeoTIFF tie point x = -7,663,600 m = -180°. MD3 color is an enhanced
  // 3-filter composite; keep its luminance and apply Mercury's disk color.
  {
    key: 'mercury',
    source: ['usgs-mercury-messenger-md3', 'Mercury_MD3Color_665m.tif'],
    lon: 'east-center',
    widths: [2048, 4096, 8192],
    encoding: 'etc1s',
    // Linear-light ratios of derived disk color sRGB #70695C (Mallama et al. 2017) to its luminance.
    greyTint: [1.133, 0.986, 0.748],
    note: 'Luminance from MESSENGER MDIS MD3 color; hue set from disk-integrated color indices.',
  },

  // OPAL README: "left edge = 0 System III W. longitude, decreasing to the right",
  // planetographic latitude. Jupiter flattening 0.06487 (NSSDCA radii 71492/66854 km).
  {
    key: 'jupiter',
    source: ['opal-jupiter-2025a', 'jupiter-2025a-globalmap.tif'],
    lon: 'west-left0',
    planetographicF: 1 - 66854 / 71492,
    fillPoles: true,
    widths: [2048, 4096],
    encoding: 'etc1s',
    note: 'Hubble OPAL, 11-12 Dec 2025. Cloud features drift; this is a snapshot.',
  },

  // FITS header: LAT_C '-90:0.1:90' planetocentric, LON_W '360.0:-0.1:0.0'.
  // 3601 columns include 0° and 360°. South polar cap was in winter darkness.
  {
    key: 'saturn',
    source: ['cassini-iss-saturn-rgb', 'Cassini_ISS_RGB_Saturn_global_color_map_original.fits'],
    lon: 'west-left0',
    dropLastColumn: true,
    fillPoles: true,
    widths: [2048, 4096],
    encoding: 'etc1s',
    note: 'Cassini ISS, 11 Aug 2011. South polar cap (no data, winter night) filled with the nearest zonal mean.',
  },

  // Black Marble 2016: -180..180, east right.
  { key: 'earth-night', source: ['black-marble-2016', 'BlackMarble_2016_3km.jpg'], lon: 'east-center', widths: [4096, 8192], encoding: 'etc1s' },

  // MODIS cloud composite: -180..180, east right. Greyscale; stored in one channel.
  { key: 'earth-clouds', source: ['modis-clouds', 'cloud_combined_8192.tif'], lon: 'east-center', widths: [4096, 8192], encoding: 'etc1s', bands: 1 },

  // ---- moons and dwarf planets (GeoTIFF tie points checked for each) ----
  // Tie point x = -width/2 × scale (-180°..180°, east right) unless noted.
  { key: 'io', source: ['usgs-io', 'Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'europa', source: ['usgs-europa', 'Europa_Voyager_GalileoSSI_global_mosaic_500m.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'ganymede', source: ['usgs-ganymede', 'Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'callisto', source: ['usgs-callisto', 'Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  // Enceladus and Rhea: tie point x = 0, i.e. 0°..360° east; shift to center 0°.
  { key: 'enceladus', source: ['usgs-enceladus', 'Enceladus_Cassini_mosaic_global_110m.tif'], lon: 'east-left0', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'tethys', source: ['usgs-tethys', 'Tethys_Cassini_mosaic_global_293m.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'dione', source: ['usgs-dione', 'Dione_Cassini_Voyager_mosaic_global_154m.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'rhea', source: ['usgs-rhea', 'Rhea_Cassini_Voyager_mosaic_global_417m.tif'], lon: 'east-left0', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'iapetus', source: ['usgs-iapetus', 'Iapetus_Cassini_Voyager_mosaic_global_783m.tif'], lon: 'east-center', widths: [2048, 4096], encoding: 'etc1s' },
  // PIA17214 has no georeferencing: Herschel crater (1.4°N, 111.8°W) sits at
  // 18.6% of the width, so the map is centered on 0° with east to the right.
  { key: 'mimas', source: ['pia17214-mimas', 'PIA17214.tif'], lon: 'east-center', widths: [2048, 4096], encoding: 'etc1s' },
  { key: 'triton', source: ['usgs-triton', 'Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'phobos', source: ['usgs-phobos', 'Phobos_Viking_Mosaic_40ppd_DLRcontrol.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'charon', source: ['usgs-charon', 'Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'pluto', source: ['usgs-pluto', 'Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },
  { key: 'ceres', source: ['usgs-ceres', 'Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif'], lon: 'east-center', widths: [2048, 4096], encoding: 'etc1s' },
  { key: 'vesta', source: ['usgs-vesta', 'Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif'], lon: 'east-center', widths: [2048, 4096, 8192], encoding: 'etc1s' },

  // NASA SVS Deep Star Maps 2020, Milky Way layer (bright Hipparcos/Tycho stars
  // removed; those come from HYG). Celestial frame, centered at RA 0h, RA
  // increasing to the left: kept as-is and sampled by RA/Dec in the sky shader.
  {
    key: 'sky-milkyway',
    source: ['svs-deep-star-maps-2020', 'milkyway_2020_8k.exr'],
    lon: 'east-center',
    linearFloat: true,
    widths: [4096, 8192],
    encoding: 'uastc',
  },

  // Blue Marble Next Generation 2004 monthly "base" (no baked relief), -180..180.
  ...MONTHS.map(
    (m): TextureJob => ({
      key: `earth-${m}`,
      source: ['bmng-2004', `world.2004${m}.jpg`],
      lon: 'east-center',
      widths: [2048, 4096, 8192],
      encoding: 'etc1s',
    }),
  ),
];

// Detail tiles for the close-up Earth (level 4 = 16384 × 8192, 2.4 km/px at
// the equator) from the 21600 × 10800 monthly Blue Marble sources.
export const TILE_JOBS: TileSetJob[] = [
  ...MONTHS.map((m): TileSetJob => ({
    set: `earth-${m}`,
    source: ['bmng-2004', `world.2004${m}.jpg`],
    levels: [4],
  })),
  // Moon: LROC WAC color (16384 px source) -> 0.67 km/px at level 4.
  { set: 'moon', source: ['svs-cgi-moon-kit', 'lroc_color_poles_16k.tif'], levels: [4] },
  // Mars: Viking color mosaic (925 m/px source) -> 1.3 km/px at level 4.
  { set: 'mars', source: ['usgs-mars-viking-color', 'Mars_Viking_ClrMosaic_global_925m.tif'], levels: [4] },
];
