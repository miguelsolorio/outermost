// A small static solar system plus far-away targets, shared by the camera and
// ship tests. `now.t` moves Earth (and the Moon with it) when `now.speed` is set;
// ids in `gone` stop resolving, like a spacecraft before its launch.
import type { FocusTarget } from '../../src/engine/camera/controller.ts';
import { add, type Vec3 } from '../../src/astro/vec.ts';

export const AU = 1.496e11;
export const FOV = (45 * Math.PI) / 180;
export const DT = 1 / 60;
const TILT = (23.4 * Math.PI) / 180;

export function fakeTargets() {
  const now = { t: 0, speed: 0 };
  const gone = new Set<string>();
  const earth = (): Vec3 => {
    const a = now.t * now.speed;
    return [AU * Math.cos(a), AU * Math.sin(a), 0];
  };
  const body = (id: string, pos: () => Vec3, radius: number, parent: string | null, extra: Partial<FocusTarget> = {}): FocusTarget => ({
    id,
    radius,
    minAltitude: radius > 0 ? 0.01 * radius : 1e5,
    pos,
    pole: () => (radius > 0 ? [0, -Math.sin(TILT), Math.cos(TILT)] : null),
    handoff: null,
    parent,
    ...extra,
  });
  const targets = new Map<string, FocusTarget>();
  for (const t of [
    body('sun', () => [0, 0, 0], 6.96e8, null, { minAltitude: 0.3 * 6.96e8 }),
    body('earth', earth, 6.371e6, 'sun', { handoff: [0.3 * AU, 1.5 * AU] }),
    body('moon', () => add(earth(), [0, 3.84e8, 0]), 1.737e6, 'earth', { handoff: [1.2e9, 3.8e9] }),
    body('mars', () => [-1.2 * AU, 1.1 * AU, 0.03 * AU], 3.39e6, 'sun', { handoff: [0.46 * AU, 2.3 * AU] }),
    body('saturn', () => [8 * AU, -4 * AU, 0.3 * AU], 5.8e7, 'sun', { handoff: [2.9 * AU, 14 * AU] }),
    // Framed inside its own handoff range: landing must still match the free camera.
    body('craft', () => [100 * AU, 120 * AU, 30 * AU], 0, 'sun', { handoff: [2 * AU, 20 * AU], framing: 40 * AU }),
    // A low-orbit craft riding along with Earth.
    body('iss', () => add(earth(), [6.8e6, 0, 0]), 0, 'earth', { handoff: [5 * 6.371e6, 50 * 6.371e6], framing: 7e6, minAltitude: 2.5e6 }),
    // A black hole kiloparsecs away, framed at 110 rs.
    body('far', () => [6e19, 3e19, 2.5e19], 2.66e4, null, { framing: 110 * 2.66e4, minAltitude: 1e4 }),
    body('uni', () => [0, 0, 0], 0, null, { framing: 1.05e27 }),
  ])
    targets.set(t.id, t);
  const resolve = (id: string): FocusTarget | undefined => (gone.has(id) ? undefined : targets.get(id));
  return { targets, now, gone, resolve };
}
