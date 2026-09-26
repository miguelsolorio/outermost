// Registry provider for the Milky Way itself.

import { KPC, LY } from '../../astro/units.ts';
import type { FocusTarget } from '../../engine/camera/controller.ts';
import type { ObjectInfo, Provider, SearchEntry } from '../registry.ts';
import type { World } from '../world.ts';
import { galaxyFrame } from '../../astro/galactic.ts';
import { centralBlackHoleFact } from '../../data/blackHoles.ts';

const REID = { name: 'Reid et al. 2019, ApJ 885, 131', url: 'https://doi.org/10.3847/1538-4357/ab4a11' };
const GRAVITY = { name: 'GRAVITY Collaboration 2019, A&A 625, L10', url: 'https://doi.org/10.1051/0004-6361/201935656' };
const BHG = { name: 'Bland-Hawthorn & Gerhard 2016, ARA&A 54, 529', url: 'https://doi.org/10.1146/annurev-astro-081915-023441' };
const WEGG = { name: 'Wegg, Gerhard & Portail 2015, MNRAS 450, 4050', url: 'https://doi.org/10.1093/mnras/stv745' };
const BB = { name: 'Bennett & Bovy 2019, MNRAS 482, 1417', url: 'https://doi.org/10.1093/mnras/sty2813' };
const LC = { name: 'López-Corredoira et al. 2018, A&A 612, L8', url: 'https://doi.org/10.1051/0004-6361/201832880' };

export class GalaxyProvider implements Provider {
  private t: FocusTarget;
  private frame = galaxyFrame();

  constructor(private world: World) {
    this.t = {
      id: 'milky-way',
      radius: 0.2 * KPC,
      minAltitude: 0.3 * KPC,
      pos: () => {
        const s = this.world.get('sun').pos;
        const c = this.frame.center;
        return [s[0] + c[0], s[1] + c[1], s[2] + c[2]];
      },
      pole: () => this.frame.z,
      handoff: [300 * KPC, 2000 * KPC],
      parent: 'local-group',
      framing: 60 * KPC,
    };
  }

  target(id: string): FocusTarget | undefined {
    return id === 'milky-way' ? this.t : undefined;
  }

  info(id: string): ObjectInfo | undefined {
    if (id !== 'milky-way') return undefined;
    // Galactic year from the angular rotation rate (Θ0 + V☉)/R0 = 30.32 km/s/kpc.
    const secPerMyr = 3.15576e13;
    const galYear = (2 * Math.PI * 3.0857e16) / 30.32 / secPerMyr;
    return {
      id,
      name: 'Milky Way',
      subtitle: 'Barred spiral galaxy · our home',
      facts: [
        { label: 'Sun to Galactic Center', value: `8.178 kpc (${Math.round((8.178 * KPC) / LY).toLocaleString('en-US')} ly)`, kind: 'measured', source: GRAVITY },
        { label: 'Sun above the midplane', value: '20.8 pc', kind: 'measured', source: BB },
        { label: 'Sun’s orbital speed', value: '≈ 236 km/s', kind: 'measured', source: REID },
        { label: 'Galactic year (one orbit)', value: `≈ ${Math.round(galYear)} million years`, kind: 'derived', source: REID },
        { label: 'Stellar mass', value: '≈ 5 × 10¹⁰ Suns', kind: 'measured', source: BHG },
        { label: 'Disk scale length', value: '≈ 2.6 kpc', kind: 'measured', source: BHG },
        { label: 'Bar half-length and angle', value: '≈ 5.0 kpc at 27°', kind: 'measured', source: WEGG },
        { label: 'Spiral arms mapped', value: 'Norma–Outer, Scutum–Centaurus, Sagittarius–Carina, Perseus, Local', kind: 'measured', source: REID },
        { label: 'Most distant disk stars', value: '≈ 26 kpc from the center', kind: 'measured', source: LC },
        ...[centralBlackHoleFact('milky-way')].filter((f) => !!f),
      ],
      notes: [
        {
          text: "No photograph of our galaxy from outside exists. This view is a model: spiral arms follow the maser-parallax fits of Reid et al. 2019 (drawn fainter where extrapolated), with a bar, bulge, exponential disks and dust tuned to published scales. Fine texture (star clusters, dust filaments and color) is styled on Hubble images of face-on spirals like M101 and is illustrative.",
          kind: 'model',
        },
      ],
    };
  }

  search(): SearchEntry[] {
    return [
      { id: 'milky-way', name: 'Milky Way', aliases: ['Galaxy', 'Our galaxy', 'Galactic Center'], kind: 'Galaxy', detail: 'Our galaxy', rank: 0 },
    ];
  }
}
