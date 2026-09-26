// Everything the user can search for, click, fly to and read about lives here:
// focus targets for the camera, search entries and info-card content, with
// every fact carrying its provenance.

import type { FocusTarget } from '../engine/camera/controller.ts';
import type { FactKind } from '../data/facts.ts';

export interface InfoFact {
  label: string;
  value: string;
  kind: FactKind;
  source: { name: string; url: string };
}

export interface ObjectInfo {
  id: string;
  name: string;
  subtitle: string;
  facts: InfoFact[];
  /** Short notes on how the object is depicted (e.g. "texture from Hubble OPAL, Dec 2025"). */
  notes: Array<{ text: string; kind: FactKind }>;
}

export interface SearchEntry {
  id: string;
  name: string;
  /** Alternate names/designations that should also match. */
  aliases?: string[];
  kind: string;
  detail?: string;
  /** Lower sorts first among equal matches. */
  rank: number;
  /** Spread around us (a belt, our supercluster) rather than at a point, so it has no useful distance. */
  diffuse?: boolean;
  /** Marks the result's category with a colored dot (CSS color). */
  color?: string;
}

export interface Provider {
  target(id: string): FocusTarget | undefined;
  info(id: string): ObjectInfo | undefined;
  search(): SearchEntry[];
}

export class Registry {
  private providers: Provider[] = [];

  add(p: Provider): void {
    this.providers.push(p);
  }

  target(id: string): FocusTarget | undefined {
    for (const p of this.providers) {
      const t = p.target(id);
      if (t) return t;
    }
    return undefined;
  }

  info(id: string): ObjectInfo | undefined {
    for (const p of this.providers) {
      const i = p.info(id);
      if (i) return i;
    }
    return undefined;
  }

  search(): SearchEntry[] {
    return this.providers.flatMap((p) => p.search());
  }
}
