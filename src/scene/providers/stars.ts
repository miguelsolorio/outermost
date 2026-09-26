// Registry provider for catalog stars (ids "star-<index>").

import { bolometricCorrection, bvToTemperature } from '../../astro/color.ts';
import { AU, LY, PC } from '../../astro/units.ts';
import type { FocusTarget } from '../../engine/camera/controller.ts';
import type { ObjectInfo, Provider, SearchEntry } from '../registry.ts';
import type { World } from '../world.ts';
import type { StarMeta, StarsLayer } from '../layers/stars.ts';

const SUN_RADIUS = 695_700_000; // m, NSSDCA
const SUN_TEFF = 5772; // K, IAU 2015 Resolution B3 nominal

const HYG = { name: 'HYG Database v4.4', url: 'https://codeberg.org/astronexus/hyg' };
const ATHYG = { name: 'AT-HYG v4.0 (Gaia DR3)', url: 'https://codeberg.org/astronexus/athyg' };
const BALLESTEROS = { name: 'Ballesteros 2012, EPL 97, 34008 (B−V → T)', url: 'https://arxiv.org/abs/1201.1809' };
const TORRES = { name: 'Torres 2010, AJ 140, 1158 (bolometric correction)', url: 'https://doi.org/10.1088/0004-6256/140/5/1158' };

export function starDisplayName(m: StarMeta): string {
  return m.name ?? m.bayer ?? m.flam ?? (m.hip ? `HIP ${m.hip}` : `Star ${m.i}`);
}

/**
 * Radius from the Stefan-Boltzmann law, R/R☉ = √(L/L☉) / (T/T☉)², with the
 * visual luminosity converted to bolometric using BC_V(T) (Torres 2010).
 * An estimate: B−V temperatures are rough for supergiants and reddened stars.
 */
export function starRadius(m: StarMeta): number {
  const T = m.ci !== undefined ? bvToTemperature(m.ci) : SUN_TEFF;
  const lbol = Math.max(m.lum, 1e-6) * 10 ** (-0.4 * (bolometricCorrection(T) - bolometricCorrection(SUN_TEFF)));
  return (SUN_RADIUS * Math.sqrt(lbol)) / (T / SUN_TEFF) ** 2;
}

export class StarsProvider implements Provider {
  private targets = new Map<string, FocusTarget>();

  constructor(
    private world: World,
    private layer: StarsLayer,
  ) {}

  private meta(id: string): StarMeta | undefined {
    if (!id.startsWith('star-') || !this.layer.catalog) return undefined;
    return this.layer.catalog.byIndex.get(Number(id.slice(5)));
  }

  target(id: string): FocusTarget | undefined {
    const cached = this.targets.get(id);
    if (cached) return cached;
    const m = this.meta(id);
    if (!m) return undefined;
    const R = starRadius(m);
    const t: FocusTarget = {
      id,
      radius: R,
      minAltitude: 2 * R,
      pos: () => {
        const sun = this.world.get('sun').pos;
        const p = this.layer.starPos(m.i, this.world.ms);
        return [sun[0] + p[0], sun[1] + p[1], sun[2] + p[2]];
      },
      pole: () => null,
      handoff: null,
      parent: null,
    };
    this.targets.set(id, t);
    return t;
  }

  info(id: string): ObjectInfo | undefined {
    const m = this.meta(id);
    if (!m) return undefined;
    const simbad = { name: 'Literature value (SIMBAD entry)', url: `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=HIP+${m.hip}` };
    const distSource = m.distSrc === 'gaia' ? ATHYG : m.distSrc === 'override' ? simbad : HYG;
    const facts: ObjectInfo['facts'] = [];
    const add = (label: string, value: string, kind: ObjectInfo['facts'][number]['kind'], source = HYG) =>
      facts.push({ label, value, kind, source });
    if (m.bayer && m.name) add('Designation', m.bayer, 'measured');
    if (m.hip) add('Hipparcos number', `HIP ${m.hip}`, 'measured');
    add('Distance from the Sun', `${(m.dist * (PC / LY)).toLocaleString('en-US', { maximumSignificantDigits: 4 })} light-years (${m.dist.toLocaleString('en-US', { maximumSignificantDigits: 4 })} pc)`, 'measured', distSource);
    add('Apparent magnitude (from Earth)', m.mag.toFixed(2), 'measured');
    add('Absolute magnitude', m.absmag.toFixed(2), 'derived');
    if (m.spect) add('Spectral type', m.spect, 'measured');
    if (m.ci !== undefined) {
      add('Color index (B−V)', m.ci.toFixed(2), 'measured');
      add('Surface temperature (from B−V)', `≈ ${Math.round(bvToTemperature(m.ci) / 10) * 10} K`, 'derived', BALLESTEROS);
    }
    add('Luminosity (visual)', `${m.lum.toLocaleString('en-US', { maximumSignificantDigits: 3 })} × Sun`, 'derived');
    const R = starRadius(m) / SUN_RADIUS;
    add('Radius (estimated)', `≈ ${R.toLocaleString('en-US', { maximumSignificantDigits: 2 })} × Sun`, 'derived', TORRES);
    if (m.con) add('Constellation', m.con, 'measured', { name: 'IAU boundaries via HYG', url: HYG.url });
    return {
      id,
      name: starDisplayName(m),
      subtitle: m.spect ? `Star · ${m.spect}` : 'Star',
      facts,
      notes: [
        {
          text: `Shown at its catalog position with proper motion. Size and color on screen come from its brightness and B−V color index; the radius is estimated from its luminosity (with a bolometric correction) and temperature (${(R * SUN_RADIUS / AU).toPrecision(2)} AU).`,
          kind: 'derived',
        },
      ],
    };
  }

  search(): SearchEntry[] {
    if (!this.layer.catalog) return [];
    return this.layer.catalog.meta
      .filter((m) => m.name || (m.bayer && m.mag < 4.5))
      .map((m) => ({
        id: `star-${m.i}`,
        name: starDisplayName(m),
        aliases: [m.bayer, m.flam, m.hip ? `HIP ${m.hip}` : undefined].filter(Boolean) as string[],
        kind: 'Star',
        detail: `${m.con ? m.con + ' · ' : ''}${(m.dist * (PC / LY)).toLocaleString('en-US', { maximumSignificantDigits: 3 })} ly`,
        rank: m.name ? 2 : 3,
      }));
  }
}
