// Registry provider for Solar System bodies.

import { factsFor } from '../../data/facts.ts';
import { KPC } from '../../astro/units.ts';
import type { FocusTarget } from '../../engine/camera/controller.ts';
import { BODIES, BODY_BY_ID, meanRadius, type BodyDef } from '../catalog.ts';
import type { ObjectInfo, Provider, SearchEntry } from '../registry.ts';
import type { World } from '../world.ts';

const PX_PER_RAD_REF = 1000; // reference screen density for minimum-altitude rules

export function minAltitude(def: BodyDef): number {
  const R = meanRadius(def);
  if (def.kind === 'star') return 0.3 * R;
  const w = def.appearance.textureWidth;
  if (!w) return 0.3 * R;
  const texel = (2 * Math.PI * def.radii[0]) / w;
  return Math.max(texel * PX_PER_RAD_REF, 0.05 * R);
}

function handoff(def: BodyDef): [number, number] | null {
  if (!def.parent) return null;
  const a = def.semiMajorAxis;
  return def.kind === 'moon' ? [3 * a, 10 * a] : [0.3 * a, 1.5 * a];
}

const KIND: Record<string, string> = { star: 'Star', planet: 'Planet', 'dwarf-planet': 'Dwarf planet', moon: 'Moon' };

export class BodiesProvider implements Provider {
  private targets = new Map<string, FocusTarget>();

  constructor(private world: World) {
    for (const def of BODIES) {
      const st = () => world.get(def.id);
      this.targets.set(def.id, {
        id: def.id,
        radius: meanRadius(def),
        minAltitude: minAltitude(def),
        pos: () => st().pos,
        pole: () => {
          const m = st().orient;
          return [m[2], m[5], m[8]];
        },
        handoff: def.id === 'sun' ? [2 * KPC, 20 * KPC] : handoff(def),
        parent: def.id === 'sun' ? 'milky-way' : def.parent,
      });
    }
  }

  target(id: string): FocusTarget | undefined {
    const t = this.targets.get(id);
    // Bodies without data right now (e.g. a spacecraft before launch) can't be targeted.
    return t && this.world.get(id).valid ? t : undefined;
  }

  info(id: string): ObjectInfo | undefined {
    const def = BODY_BY_ID.get(id);
    if (!def) return undefined;
    const parent = def.parent ? BODY_BY_ID.get(def.parent) : undefined;
    return {
      id,
      name: def.name,
      subtitle: `${KIND[def.kind] ?? def.kind}${def.kind === 'moon' && parent ? ` of ${parent.name}` : ''}`,
      facts: factsFor(def.factsKey).map((f) => ({
        label: f.label,
        value: f.value,
        kind: f.kind,
        source: { name: 'NASA NSSDCA fact sheet', url: f.sourceUrl },
      })),
      notes: def.appearance.appearanceSource ? [{ text: def.appearance.appearanceSource, kind: 'measured' }] : [],
    };
  }

  search(): SearchEntry[] {
    return BODIES.map((b) => ({
      id: b.id,
      name: b.name,
      kind: KIND[b.kind] ?? b.kind,
      detail: b.kind === 'moon' && b.parent ? `Moon of ${BODY_BY_ID.get(b.parent)?.name}` : KIND[b.kind],
      rank: b.kind === 'planet' || b.kind === 'star' ? 0 : 1,
    }));
  }
}
