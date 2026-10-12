import { Vector3, type Box3, type Ray } from 'three';
import type { SignalId } from '../content/signals';

/** What a click in the city can land on. */
export type PickTarget = { kind: 'district'; id: number } | { kind: 'secret'; id: SignalId } | { kind: 'vehicle' };

export interface Pickable {
  /** A box, or a function for things that move (read at pick time). */
  box: Box3 | (() => Box3);
  target: PickTarget;
  /** Shown in the guidance line while hovered. */
  label: string;
}

const hit = new Vector3();

/** The pickable whose box the ray enters first (within maxDistance), or null. */
export function pickNearest(ray: Ray, items: readonly Pickable[], maxDistance = Infinity): Pickable | null {
  let best: Pickable | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    const box = typeof item.box === 'function' ? item.box() : item.box;
    if (!ray.intersectBox(box, hit)) continue;
    const d = hit.distanceTo(ray.origin);
    if (d < bestDistance && d <= maxDistance) {
      bestDistance = d;
      best = item;
    }
  }
  return best;
}

/** v1: a release within 5 px of the press is a click; anything more was a drag. */
export function isClick(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= 5;
}
