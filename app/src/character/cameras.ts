import { Vector3, type PerspectiveCamera } from 'three';
import type { CollisionWorld } from '../world/collision';

export const BOOM_LENGTH = 3.6;
export const BOOM_HEIGHT = 1.6;
export const EYE_HEIGHT = 1.68;
const WALL_CLEARANCE = 0.2;

export interface WalkCameras {
  mode: 'third' | 'first';
  /** Pivots around the character; yaw 0 looks down −z, pitch > 0 looks up. */
  update(dt: number, feet: Vector3, yaw: number, pitch: number): void;
  toggle(): void;
}

/** Third-person spring boom that never passes through walls, and a first-person eye. */
export function createWalkCameras(camera: PerspectiveCamera, world: CollisionWorld): WalkCameras {
  const pivot = new Vector3();
  const back = new Vector3();
  const look = new Vector3();
  let boom = BOOM_LENGTH;
  const cams: WalkCameras = {
    mode: 'third',
    update(dt, feet, yaw, pitch) {
      const fx = -Math.sin(yaw) * Math.cos(pitch);
      const fy = Math.sin(pitch);
      const fz = -Math.cos(yaw) * Math.cos(pitch);
      if (cams.mode === 'first') {
        if (camera.fov !== 70) {
          camera.fov = 70;
          camera.updateProjectionMatrix();
        }
        camera.position.set(feet.x, feet.y + EYE_HEIGHT, feet.z);
        camera.lookAt(look.set(feet.x + fx, feet.y + EYE_HEIGHT + fy, feet.z + fz));
        return;
      }
      if (camera.fov !== 55) {
        camera.fov = 55;
        camera.updateProjectionMatrix();
      }
      pivot.set(feet.x, feet.y + BOOM_HEIGHT, feet.z);
      back.set(-fx, -fy, -fz).normalize();
      const hit = world.raycast(pivot, back, BOOM_LENGTH);
      const target = hit === null ? BOOM_LENGTH : Math.max(0.3, hit - WALL_CLEARANCE);
      // Pull in instantly (never show a wall's inside), ease back out.
      boom = target < boom ? target : boom + (target - boom) * Math.min(1, dt * 4);
      camera.position.copy(pivot).addScaledVector(back, boom);
      camera.lookAt(look.set(pivot.x + fx * 4, pivot.y + fy * 4, pivot.z + fz * 4));
    },
    toggle() {
      cams.mode = cams.mode === 'third' ? 'first' : 'third';
      boom = BOOM_LENGTH;
    },
  };
  return cams;
}
