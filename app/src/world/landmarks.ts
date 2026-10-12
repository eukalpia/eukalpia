import type { BuildingSpec } from './buildings/massing';

type Vec3 = [number, number, number];

/** Where a district's landmark stands: footprint centre, ground and roof heights (m). */
export interface LandmarkFrame {
  districtId: number;
  x: number;
  z: number;
  baseY: number;
  top: number;
  /** The larger side of the ground-floor footprint. */
  size: number;
}

export function landmarkFrames(specs: readonly BuildingSpec[]): Map<number, LandmarkFrame> {
  const frames = new Map<number, LandmarkFrame>();
  for (const s of specs) {
    if (s.districtId === undefined || s.tiers.length === 0) continue;
    frames.set(s.districtId, {
      districtId: s.districtId,
      x: s.tiers[0].cx,
      z: s.tiers[0].cz,
      baseY: s.baseY,
      top: Math.max(...s.tiers.map(t => t.y1)),
      size: Math.max(s.tiers[0].width, s.tiers[0].depth),
    });
  }
  return frames;
}

/** The camera pose for a selected district: up and out to the south-east, looking at mid-height. */
export function focusPose(f: LandmarkFrame): { position: Vec3; target: Vec3 } {
  const h = f.top - f.baseY;
  const reach = Math.max(h, 70);
  return {
    position: [f.x + 0.6 * reach, f.baseY + 0.45 * h + 0.35 * reach + 25, f.z + 0.7 * reach],
    target: [f.x, f.baseY + 0.5 * h, f.z],
  };
}
