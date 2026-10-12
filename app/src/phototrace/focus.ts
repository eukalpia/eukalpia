import { Vector3, type Camera } from 'three';

const origin = new Vector3();
const dir = new Vector3();
const forward = new Vector3();

/**
 * Distance to whatever is under a click (normalised device coordinates), for depth-of-field focus.
 * The sky, the void below the islands and anything odd come back as Infinity.
 */
export function focusDistance(
  world: { raycast(origin: Vector3, dir: Vector3, far: number): number | null },
  camera: Camera,
  ndcX: number,
  ndcY: number,
): number {
  if (!Number.isFinite(ndcX) || !Number.isFinite(ndcY)) return Infinity;
  camera.updateMatrixWorld();
  origin.setFromMatrixPosition(camera.matrixWorld);
  dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(origin).normalize();
  const d = world.raycast(origin, dir, 20000);
  if (d === null || !Number.isFinite(d) || d <= 0) return Infinity;
  // The focal plane faces the camera: measure along the view axis, not along the click ray.
  forward.set(0, 0, -1).transformDirection(camera.matrixWorld);
  return d * Math.max(0.05, dir.dot(forward));
}

/** `eukalpia-2026-10-12T12-30-05.png`: sortable and safe in every file system. */
export function saveName(date: Date): string {
  return `eukalpia-${date.toISOString().slice(0, 19).replaceAll(':', '-')}.png`;
}
