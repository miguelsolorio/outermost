// Registry provider for black holes (ids "bh-<name>"): camera targets, info
// cards, search entries and labels, plus the list of lenses the lensing pass
// draws each frame.

import { blackbodyLinearRgb } from '../../astro/color.ts';
import { diskAxis, keplerSeparation, schwarzschildRadius, shadowAngularRadius } from '../../astro/blackHole.ts';
import { galaxyFrame } from '../../astro/galactic.ts';
import { AU, DEG, KPC, PC, R_SUN } from '../../astro/units.ts';
import { add, dot, fromRaDec, length, normalize, scale, smoothstep, sub, type Vec3 } from '../../astro/vec.ts';
import { BLACK_HOLE_BY_ID, BLACK_HOLE_CLASS_COLOR, BLACK_HOLES, type BlackHoleDef, type DiskDef } from '../../data/blackHoles.ts';
import type { FocusTarget, Resolver } from '../../engine/camera/controller.ts';
import { formatDistance } from '../../engine/format.ts';
import { relPrecise, type FrameCtx } from '../frame.ts';
import type { StarsLayer } from '../layers/stars.ts';
import type { ObjectInfo, Provider, SearchEntry } from '../registry.ts';
import type { World } from '../world.ts';

const SCHWARZSCHILD = { name: 'Schwarzschild radius r = 2GM/c² (GM☉: IAU 2015 B3)', url: 'https://arxiv.org/abs/1510.07674' };
const SYNGE = { name: 'Synge 1966, MNRAS 131, 463 (shadow of a black hole)', url: 'https://doi.org/10.1093/mnras/131.3.463' };

/** Where a camera goes to look at a black hole: 40 horizon radii, closest 6 (the innermost stable orbit). */
const FRAMING_RS = 40;
const MIN_ALTITUDE_RS = 5;
/** Far enough back that a 40 r_s thin disk fits on screen. */
const DISK_FRAMING_RS = 110;

/** A black hole in view, for the lensing pass. */
export interface LensSource {
  id: string;
  /** Horizon radius (m). */
  rs: number;
  /** Camera-relative position (m), exact near the camera's pivot. */
  rel: Vec3;
  /** Accretion disk, when it is shining now. */
  disk?: LensDisk;
}

export interface LensDisk {
  /** Unit angular-momentum axis (world, EQJ). */
  axis: Vec3;
  kind: DiskDef['kind'];
  /** Inner and outer radius (horizon radii). */
  rIn: number;
  rOut: number;
  /** 0..1: fades over a few days at the ends of an outburst. */
  brightness: number;
}

/** Arrive this far from a thin disk's axis: just above edge-on, as NASA frames it. */
const DISK_VIEW_DEG = 80;
/** Days an outburst disk takes to fade in or out. */
const FADE_DAYS = 3;

/** How brightly a disk shines at time ms: 1 without outburst dates, faded at their ends. */
export function diskBrightness(disk: DiskDef, ms: number): number {
  if (!disk.active) return 1;
  const fade = FADE_DAYS * 86_400_000;
  let b = 0;
  for (const { from, to } of disk.active) {
    const t0 = Date.parse(from);
    const t1 = Date.parse(to);
    b = Math.max(b, smoothstep(t0 - fade, t0, ms) * (1 - smoothstep(t1, t1 + fade, ms)));
  }
  return b;
}

export interface BlackHoleLabel {
  id: string;
  name: string;
  rel: Vec3;
  priority: number;
  alpha: number;
  /** Clears the shadow's edge on screen. */
  offsetPx: number;
}

const unit = (ra: number, dec: number): Vec3 => fromRaDec(ra * DEG, dec * DEG);
const GC = galaxyFrame().center;

/** Unit vector toward celestial north in the sky plane at direction u. */
const skyNorth = (u: Vec3): Vec3 => normalize(sub([0, 0, 1], scale(u, u[2])));

function formatPeriod(days: number): string {
  const f = (x: number, d = 3) => x.toLocaleString('en-US', { maximumSignificantDigits: d });
  if (days < 2) return `${f(days * 24)} hours`;
  if (days < 1000) return `${f(days, 5)} days`;
  return `${f(days / 365.25)} years`;
}

/** Angular size in the unit that reads best: μas, mas or arcseconds. */
function formatAngle(rad: number): string {
  const uas = (rad / DEG) * 3600e6;
  const f = (x: number) => x.toLocaleString('en-US', { maximumSignificantDigits: 3 });
  if (uas < 1e3) return `${f(uas)} μas`;
  if (uas < 1e6) return `${f(uas / 1e3)} mas`;
  return `${f(uas / 1e6)}″`;
}

export class BlackHolesProvider implements Provider {
  private cache = new Map<string, FocusTarget>();
  private hipIndex: Map<number, number> | null = null;

  constructor(
    private world: World,
    private lookup: Resolver,
    private info_: (id: string) => ObjectInfo | undefined,
    private stars: StarsLayer,
  ) {}

  private sun(): Vec3 {
    return this.world.get('sun').pos;
  }

  /** Catalog index of a HIP star, once the catalog has loaded. */
  private starIndex(hip: number): number | undefined {
    const cat = this.stars.catalog;
    if (!cat) return undefined;
    if (!this.hipIndex) this.hipIndex = new Map(cat.meta.filter((m) => m.hip).map((m) => [m.hip!, m.i]));
    return this.hipIndex.get(hip);
  }

  /** Orbit radius (m) of a black hole around its companion, when both masses are known. */
  private separation(def: BlackHoleDef): number | undefined {
    const b = def.binary;
    return b?.companionMsun ? keplerSeparation(def.mass.msun + b.companionMsun, b.periodDays) : undefined;
  }

  /** Position function, or undefined while what it depends on hasn't loaded. */
  private position(def: BlackHoleDef): (() => Vec3) | undefined {
    const p = def.placement;
    if (p.type === 'host') {
      const host = this.lookup(p.host);
      return host ? () => host.pos() : undefined;
    }
    if (p.type === 'sky') {
      const u = scale(unit(p.ra, p.dec), p.distPc * PC);
      return () => add(this.sun(), u);
    }
    const i = this.starIndex(p.hip);
    const a = this.separation(def);
    if (i === undefined || a === undefined) return undefined;
    return () => {
      const sp = this.stars.starPos(i, this.world.ms);
      return add(add(this.sun(), sp), scale(skyNorth(normalize(sp)), a));
    };
  }

  target(id: string): FocusTarget | undefined {
    const def = BLACK_HOLE_BY_ID.get(id);
    if (!def) return undefined;
    const hit = this.cache.get(id);
    if (hit) return hit;
    const pos = this.position(def);
    if (!pos) return undefined;
    const rs = schwarzschildRadius(def.mass.msun);
    const p = def.placement;
    const host = p.type === 'host' ? p.host : 'milky-way';
    // The pivot slides to the host once we zoom out past its neighborhood;
    // for a hosted hole that is the same point, so only the title changes.
    const handoff: [number, number] = p.type !== 'host' ? [2 * KPC, 20 * KPC] : host === 'virgo-cluster' ? [100 * PC, 10 * KPC] : [1 * PC, 100 * PC];
    let approach: (() => Vec3) | undefined;
    if (p.type === 'sky' || (p.type === 'host' && p.host !== 'milky-way')) {
      // Look toward the Galactic Center, so the bright inner Milky Way is what gets
      // lensed (from another galaxy, the whole Milky Way becomes an Einstein ring).
      approach = () => normalize(sub(pos(), add(this.sun(), GC)));
    } else if (p.type === 'companion') {
      // Look past the hole at its companion, whose limb falls just beside the shadow.
      approach = () => {
        const toBh = normalize(sub(pos(), this.sun()));
        return normalize(add(scale(skyNorth(toBh), Math.cos(30 * DEG)), scale(toBh, Math.sin(30 * DEG))));
      };
    }
    const disk = def.disk;
    // A hot flow arrives from Earth's side, the view the Event Horizon Telescope has.
    if (disk?.kind === 'thick') approach = () => normalize(sub(this.sun(), pos()));
    if (disk?.kind === 'thin') {
      // Come in just above edge-on, turned from the old approach about the disk axis.
      const w = approach;
      approach = () => {
        const n = this.diskAxisWorld(def)!;
        const old = w ? normalize(w()) : normalize(sub(this.sun(), pos()));
        let side = sub(old, scale(n, dot(old, n)));
        if (length(side) < 1e-6) side = sub([0, 0, 1], scale(n, n[2]));
        const c = Math.cos(DISK_VIEW_DEG * DEG);
        return normalize(add(scale(n, c), scale(normalize(side), Math.sqrt(1 - c * c))));
      };
    }
    const t: FocusTarget = {
      id,
      radius: rs,
      minAltitude: MIN_ALTITUDE_RS * rs,
      pos,
      pole: () => null,
      handoff,
      parent: host,
      framing: (disk?.kind === 'thin' ? DISK_FRAMING_RS : FRAMING_RS) * rs,
      approach,
    };
    this.cache.set(id, t);
    return t;
  }

  /**
   * Disk axis in world coordinates (EQJ), from the hole's current position:
   * tilted from the direction to the Sun by the measured inclination.
   */
  diskAxisWorld(def: BlackHoleDef): Vec3 | undefined {
    const disk = def.disk;
    const pos = disk && this.target(def.id)?.pos();
    if (!disk || !pos) return undefined;
    const e = normalize(sub(this.sun(), pos));
    return diskAxis(e, skyNorth(scale(e, -1)), disk.inclinationDeg, disk.axisPaDeg, disk.axisAway);
  }

  /** Distance fact: published for stellar holes, the host's for supermassive ones. */
  private distanceFact(def: BlackHoleDef, d: number): ObjectInfo['facts'][number] {
    if (def.distance) return { label: 'Distance from the Sun', value: def.distance.text, kind: 'measured', source: def.distance.source };
    const p = def.placement;
    const hostFact = p.type === 'host' ? this.info_(p.host)?.facts.find((f) => f.label === 'Distance' || f.label === 'Sun to Galactic Center') : undefined;
    return { label: 'Distance from the Sun', value: hostFact?.value ?? formatDistance(d), kind: 'measured', source: hostFact?.source ?? def.mass.source };
  }

  info(id: string): ObjectInfo | undefined {
    const def = BLACK_HOLE_BY_ID.get(id);
    const t = this.target(id);
    if (!def || !t) return undefined;
    const rs = t.radius;
    const d = length(sub(t.pos(), this.sun()));
    const stellar = def.cls === 'stellar';
    const facts: ObjectInfo['facts'] = [
      { label: 'Mass', value: def.mass.text, kind: 'measured', source: def.mass.source },
      { label: 'Event horizon radius', value: `${formatDistance(rs)} (non-spinning)`, kind: 'derived', source: SCHWARZSCHILD },
      this.distanceFact(def, d),
      { label: 'Shadow seen from Earth', value: `${formatAngle(2 * shadowAngularRadius(rs, d))} across`, kind: 'derived', source: SYNGE },
    ];
    const b = def.binary;
    if (b) {
      facts.push({ label: 'Companion star', value: b.companion, kind: 'measured', source: b.source });
      facts.push({ label: 'Orbital period', value: formatPeriod(b.periodDays), kind: 'measured', source: b.periodSource ?? b.source });
      const a = this.separation(def);
      if (a) facts.push({ label: 'Orbit size (Kepler’s third law)', value: `${(a / AU).toLocaleString('en-US', { maximumSignificantDigits: 3 })} AU`, kind: 'derived', source: b.source });
    }
    facts.push(...def.facts);
    if (def.disk) facts.push(...def.disk.facts);

    const p = def.placement;
    const where =
      p.type === 'host'
        ? p.host === 'milky-way'
          ? 'Placed at its radio position, which the Milky Way model is centered on.'
          : `Placed at the catalog center of its galaxy${p.host === 'virgo-cluster' ? ' (M87)' : ''}.`
        : p.type === 'sky'
          ? 'Its companion star is too faint for our star catalog and is not drawn.'
          : `Placed one orbit radius (${((this.separation(def) ?? 0) / AU).toFixed(2)} AU) north of its companion on the sky; where it is along the orbit is not modeled.`;
    return {
      id,
      name: def.name,
      subtitle: `${stellar ? 'Stellar black hole' : 'Supermassive black hole'} · ${def.where}`,
      facts,
      notes: [
        { text: def.note, kind: 'measured' },
        {
          text: `Drawn as a non-spinning black hole: the shadow and the bending of starlight around it are computed exactly for that case, including the rings of repeated images at the shadow's edge. Only what is on screen can be bent into view; light from elsewhere is filled in from a mirrored copy of the view. ${where}`,
          kind: 'model',
        },
        ...(def.disk?.notes ?? [{ text: 'No accretion disk or jet is drawn.', kind: 'model' as const }]),
      ],
    };
  }

  search(): SearchEntry[] {
    const out: SearchEntry[] = [];
    for (const def of BLACK_HOLES) {
      if (!this.target(def.id)) continue;
      out.push({
        id: def.id,
        name: def.name,
        aliases: def.aliases,
        kind: 'Black hole',
        detail: `${def.cls === 'stellar' ? 'Stellar black hole' : 'Supermassive black hole'} · ${def.where}`,
        rank: def.rank,
        color: BLACK_HOLE_CLASS_COLOR[def.cls],
      });
    }
    return out;
  }

  /** The catalog star to draw as a sphere beside a focused black hole, if any. */
  companion(focusId: string): { index: number; radius: number; color: [number, number, number] } | null {
    const def = BLACK_HOLE_BY_ID.get(focusId);
    const p = def?.placement;
    const b = def?.binary;
    if (p?.type !== 'companion' || !b?.companionRsun) return null;
    const index = this.starIndex(p.hip);
    if (index === undefined) return null;
    return { index, radius: b.companionRsun * R_SUN, color: blackbodyLinearRgb(b.companionTeff ?? 5772) };
  }

  /** Every resolved black hole, camera-relative. */
  lenses(ctx: FrameCtx): LensSource[] {
    const out: LensSource[] = [];
    for (const def of BLACK_HOLES) {
      const t = this.target(def.id);
      if (!t) continue;
      const src: LensSource = { id: def.id, rs: t.radius, rel: relPrecise(t.pos(), ctx.pose) };
      const d = def.disk;
      const brightness = d ? diskBrightness(d, this.world.ms) : 0;
      if (d && brightness > 0) src.disk = { axis: this.diskAxisWorld(def)!, kind: d.kind, rIn: d.rInRs, rOut: d.rOutRs, brightness };
      out.push(src);
    }
    return out;
  }

  /** Labels, faded in by class: stellar holes among the stars, supermassive ones inside their galaxy. */
  labels(ctx: FrameCtx): BlackHoleLabel[] {
    const out: BlackHoleLabel[] = [];
    const ln = Math.log;
    const s = length(sub(this.sun(), ctx.cam));
    for (const def of BLACK_HOLES) {
      const t = this.target(def.id);
      if (!t) continue;
      const rel = relPrecise(t.pos(), ctx.pose);
      const d = length(rel);
      const p = def.placement;
      let alpha: number;
      let priority = 50;
      if (def.cls === 'stellar') {
        alpha = smoothstep(ln(2000 * AU), ln(20000 * AU), ln(s)) * (1 - smoothstep(ln(3 * KPC), ln(10 * KPC), ln(d)));
      } else if (p.type === 'host' && p.host === 'milky-way') {
        alpha = 1 - smoothstep(ln(1.5 * KPC), ln(5 * KPC), ln(d));
        priority = 97;
      } else if (p.type === 'host' && p.host === 'virgo-cluster') {
        alpha = 1 - smoothstep(ln(10 * KPC), ln(40 * KPC), ln(d));
        priority = 60;
      } else {
        const R = this.lookup(p.type === 'host' ? p.host : '')?.radius ?? 5 * KPC;
        alpha = 1 - smoothstep(ln(0.5 * R), ln(2 * R), ln(d));
        priority = 60;
      }
      const offsetPx = Math.min(300, Math.max(8, shadowAngularRadius(t.radius, d) * ctx.pxPerRad));
      out.push({ id: def.id, name: def.name, rel, priority, alpha, offsetPx });
    }
    return out;
  }
}
