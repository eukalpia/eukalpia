import { Box3, Ray, Vector3 } from 'three';
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

const HALF_FOV = (20 * Math.PI) / 180;
/** The tower and its sign take this share of the 40° view's height. */
const FILL = 0.7;
/** Elevations tried from low to high, and azimuths around the south-east view v1 used. */
const ELEVATIONS = [0.42, 0.6, 0.8, 1.0];
const BASE_AZIMUTH = Math.atan2(0.6, 0.7);
const AZIMUTHS = [0, 1, -1, 2, -2, 3, -3, 4].map(k => BASE_AZIMUTH + (k * Math.PI) / 4);

const hit = new Vector3();
const ray = new Ray();
const box = new Box3();

/** Whether a building other than the landmark's stands between two points. */
function blocked(from: Vector3, to: Vector3, specs: readonly BuildingSpec[], own: number): boolean {
  const length = from.distanceTo(to);
  ray.set(from, to.clone().sub(from).normalize());
  for (const s of specs) {
    if (s.districtId === own) continue;
    for (const t of s.tiers) {
      box.min.set(t.cx - t.width / 2, t.y0, t.cz - t.depth / 2);
      box.max.set(t.cx + t.width / 2, t.y1, t.cz + t.depth / 2);
      if (ray.intersectBox(box, hit) && from.distanceTo(hit) < length) return true;
    }
  }
  return false;
}

/**
 * The camera pose for a selected district: the tower from its ground to its sign (at `labelY`) fills most
 * of the view, seen from the lowest angle at which no other building hides its middle or its roof.
 */
export function focusPose(
  f: LandmarkFrame,
  specs: readonly BuildingSpec[],
  labelY = f.top,
): { position: Vec3; target: Vec3 } {
  const span = Math.max(labelY, f.top) - f.baseY;
  const target = new Vector3(f.x, f.baseY + span / 2, f.z);
  const distance = Math.min(650, Math.max(90, span / 2 / Math.tan(HALF_FOV * FILL)));
  const marks = [new Vector3(f.x, f.baseY + (f.top - f.baseY) / 2, f.z), new Vector3(f.x, f.top - 1, f.z)];
  const at = (elevation: number, azimuth: number) =>
    new Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth))
      .multiplyScalar(distance)
      .add(target);
  for (const elevation of ELEVATIONS)
    for (const azimuth of AZIMUTHS) {
      const p = at(elevation, azimuth);
      if (!marks.some(m => blocked(p, m, specs, f.districtId)))
        return { position: p.toArray() as Vec3, target: target.toArray() as Vec3 };
    }
  return { position: at(ELEVATIONS.at(-1)!, BASE_AZIMUTH).toArray() as Vec3, target: target.toArray() as Vec3 };
}
