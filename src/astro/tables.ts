// State-vector tables baked from JPL Horizons (data/baked/ephemerides/*.json),
// evaluated with cubic Hermite interpolation on positions and velocities.
// Tables load lazily after startup; until then a body can use a fallback model.

export interface StateTable {
  id: string;
  name: string;
  center: string;
  jd0_tdb: number;
  step_days: number;
  count: number;
  /** x, y, z (km), vx, vy, vz (km/s) per sample. */
  data: number[];
}

const loaded = new Map<string, StateTable>();

export function registerTable(t: StateTable): void {
  loaded.set(t.id, t);
}

export function hasTable(id: string): boolean {
  return loaded.has(id);
}

export function tableRange(id: string): [number, number] | null {
  const t = loaded.get(id);
  return t ? [t.jd0_tdb, t.jd0_tdb + (t.count - 1) * t.step_days] : null;
}

/** Sample spacing (days). */
export function tableStep(id: string): number | null {
  return loaded.get(id)?.step_days ?? null;
}

/** Position (km) and velocity (km/s) at a TDB Julian date, or null outside the table. */
export function tableState(id: string, jdTdb: number): { pos: [number, number, number]; vel: [number, number, number] } | null {
  const t = loaded.get(id);
  if (!t) return null;
  const x = (jdTdb - t.jd0_tdb) / t.step_days;
  if (x < 0 || x > t.count - 1) return null;
  const k = Math.min(t.count - 2, Math.floor(x));
  const s = x - k;
  const h = t.step_days * 86_400; // seconds per step
  const a = t.data;
  const o0 = k * 6;
  const o1 = o0 + 6;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  // Derivatives with respect to s.
  const d00 = 6 * s2 - 6 * s;
  const d10 = 3 * s2 - 4 * s + 1;
  const d01 = -6 * s2 + 6 * s;
  const d11 = 3 * s2 - 2 * s;
  const pos: [number, number, number] = [0, 0, 0];
  const vel: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const p0 = a[o0 + c];
    const p1 = a[o1 + c];
    const v0 = a[o0 + 3 + c] * h;
    const v1 = a[o1 + 3 + c] * h;
    pos[c] = h00 * p0 + h10 * v0 + h01 * p1 + h11 * v1;
    vel[c] = (d00 * p0 + d10 * v0 + d01 * p1 + d11 * v1) / h;
  }
  return { pos, vel };
}
