import { PerspectiveCamera, Spherical, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ShotName } from '../debug';

type Vec3 = [number, number, number];

export const ORBIT_LIMITS = {
  minDistance: 60,
  maxDistance: 2200,
  /** Past the horizon (π/2) so the camera can look up at the islands' undersides. */
  maxPolarAngle: 2.0,
  target: [0, 60, 0] as Vec3,
};

/** A sidewalk spot on the east side of the ring avenue. */
export const CHARACTER_SPAWN = { x: 69, z: 150 };

export const SHOT_PRESETS: Record<ShotName, { position: Vec3; target: Vec3 }> = {
  'orbit-day': { position: [720, 420, 780], target: [0, 40, 0] },
  'orbit-night': { position: [720, 420, 780], target: [0, 40, 0] },
  underside: { position: [520, -380, 620], target: [0, -120, 0] },
  skyline: { position: [260, 70, 340], target: [0, 120, 0] },
  // Eye height on the east sidewalk of the ring avenue, looking north-west towards the monolith.
  'street-day': { position: [69, 1.7, 160], target: [48, 34, 30] },
  'street-night': { position: [69, 1.7, 160], target: [48, 34, 30] },
  // Down the east sidewalk of the ring avenue to the crossing at (56, 135): signals and storefronts.
  'street-corner': { position: [64.5, 1.7, 160], target: [62, 2.6, 128] },
  // UR-01 stands at CHARACTER_SPAWN facing +z; front and left-side portraits from 3.6 m.
  'character-front': { position: [69, 1.15, 153.6], target: [69, 0.95, 150] },
  'character-side': { position: [72.6, 1.15, 150], target: [69, 0.95, 150] },
};

export interface TourPose {
  azimuth: number;
  polar: number;
  distance: number;
}

export function tourPose(t: number): TourPose {
  return {
    azimuth: 0.6 + 0.02 * t,
    polar: 1.12 + 0.06 * Math.sin(0.05 * t),
    distance: 1150 + 80 * Math.sin(0.03 * t),
  };
}

export interface Orbit {
  update(dt: number): void;
  applyPreset(name: ShotName): void;
  /** Back to the overview after walking: unfreeze and fly out to the default orbit pose. */
  home(): void;
  readonly tourActive: boolean;
  readonly controls: OrbitControls;
  dispose(): void;
}

export function createOrbit(camera: PerspectiveCamera, dom: HTMLElement, opts: { reducedMotion: boolean }): Orbit {
  const controls = new OrbitControls(camera, dom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = ORBIT_LIMITS.minDistance;
  controls.maxDistance = ORBIT_LIMITS.maxDistance;
  controls.maxPolarAngle = ORBIT_LIMITS.maxPolarAngle;
  controls.target.fromArray(ORBIT_LIMITS.target);

  let tourActive = !opts.reducedMotion;
  let frozen = false;
  let tourTime = 0;
  const spherical = new Spherical();
  const offset = new Vector3();

  const stopTour = () => {
    tourActive = false;
  };
  dom.addEventListener('pointerdown', stopTour);
  dom.addEventListener('wheel', stopTour);

  function placeOnTour() {
    const pose = tourPose(tourTime);
    spherical.set(pose.distance, pose.polar, pose.azimuth);
    offset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
  }
  if (tourActive) placeOnTour();
  else camera.position.copy(controls.target).add(offset.setFromSpherical(spherical.set(1150, 1.12, 0.6)));
  controls.update();

  return {
    controls,
    get tourActive() {
      return tourActive;
    },
    update(dt) {
      if (frozen) return;
      if (tourActive) {
        tourTime += dt;
        placeOnTour();
        return;
      }
      controls.update(dt);
    },
    applyPreset(name) {
      const preset = SHOT_PRESETS[name];
      tourActive = false;
      frozen = true;
      controls.enabled = false;
      controls.target.fromArray(preset.target);
      camera.position.fromArray(preset.position);
      camera.lookAt(controls.target);
    },
    home() {
      frozen = false;
      controls.enabled = true;
      controls.target.fromArray(ORBIT_LIMITS.target);
      camera.position.copy(controls.target).add(offset.setFromSpherical(spherical.set(1150, 1.12, 0.6)));
      camera.lookAt(controls.target);
      controls.update();
    },
    dispose() {
      dom.removeEventListener('pointerdown', stopTour);
      dom.removeEventListener('wheel', stopTour);
      controls.dispose();
    },
  };
}
