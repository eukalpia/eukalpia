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

/** Free flight keeps the camera within this distance of the city's axis (m). */
export const FLY_RADIUS = 900;
/** Free-flight speed (m/s): v1's 9 units/s at its 0.36 units per metre. */
const FLY_SPEED = 25;

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
  // The panoramic lift on the west face of the LMS tower, from across the ring avenue, and from its roof.
  'lms-lift': { position: [46, 1.7, 30], target: [72, 34, 2] },
  'lms-roof': { position: [77.5, 193.9, 4.8], target: [-30, 105, -230] },
  // UR-01 stands at CHARACTER_SPAWN facing +z; front and left-side portraits from 3.6 m.
  'character-front': { position: [69, 1.15, 153.6], target: [69, 0.95, 150] },
  'character-side': { position: [72.6, 1.15, 150], target: [69, 0.95, 150] },
  // Close looks at UR-01's materials: head and chest from 2.2 m, and a three-quarter view.
  'character-closeup': { position: [69, 1.55, 152.2], target: [69, 1.35, 150] },
  'character-three-quarter': { position: [71.2, 1.45, 152.4], target: [69, 1.0, 150] },
};

/** Where the overview starts and where Orbit returns: the default orbit around the city. */
export const OVERVIEW_POSE: { position: Vec3; target: Vec3 } = (() => {
  const target = new Vector3().fromArray(ORBIT_LIMITS.target);
  const position = new Vector3().setFromSpherical(new Spherical(1150, 1.12, 0.6)).add(target);
  return { position: position.toArray() as Vec3, target: ORBIT_LIMITS.target };
})();
/** Floor −1: under the main island, looking up at its roots. */
export const UNDERWORLD_POSE = SHOT_PRESETS.underside;

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
  /** Ends the cinematic tour where it is, as a drag or wheel would. */
  stopTour(): void;
  /** Starts the cinematic tour (also under reduced motion: the visitor asked for it). */
  startTour(): void;
  /** Told whenever the tour starts or ends, including when a drag ends it. */
  onTourChange(fn: (on: boolean) => void): void;
  /** Eases to a pose (instantly under reduced motion); a drag cancels the flight. */
  flyTo(position: Vec3, target: Vec3): void;
  /** Holds the tour still; camera flights still finish. */
  setPaused(paused: boolean): void;
  /** Keyboard free flight: forward/right along the view, up for altitude. */
  setFly(on: boolean): void;
  setFlyInput(input: { forward: number; right: number; up: number }): void;
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
  let paused = false;
  let flying = false;
  let tourTime = 0;
  let flight: { position: Vector3; target: Vector3 } | null = null;
  const flyInput = { forward: 0, right: 0, up: 0 };
  const listeners: ((on: boolean) => void)[] = [];
  const spherical = new Spherical();
  const offset = new Vector3();
  const move = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();

  const setTour = (on: boolean) => {
    if (tourActive === on) return;
    tourActive = on;
    for (const fn of listeners) fn(on);
  };
  const stopTour = () => {
    setTour(false);
    flight = null;
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
    stopTour,
    startTour() {
      flight = null;
      frozen = false;
      controls.enabled = true;
      controls.target.fromArray(ORBIT_LIMITS.target);
      setTour(true);
      placeOnTour();
    },
    onTourChange(fn) {
      listeners.push(fn);
    },
    flyTo(position, target) {
      setTour(false);
      frozen = false;
      controls.enabled = true;
      if (opts.reducedMotion) {
        flight = null;
        camera.position.fromArray(position);
        controls.target.fromArray(target);
        controls.update();
        return;
      }
      flight = { position: new Vector3().fromArray(position), target: new Vector3().fromArray(target) };
    },
    setPaused(p) {
      paused = p;
    },
    setFly(on) {
      flying = on;
      controls.minDistance = on ? 2 : ORBIT_LIMITS.minDistance;
      if (on) setTour(false);
    },
    setFlyInput(input) {
      Object.assign(flyInput, input);
    },
    update(dt) {
      if (frozen) return;
      if (tourActive) {
        if (!paused) tourTime += dt;
        placeOnTour();
        return;
      }
      if (flight) {
        // v1's easing: close a share of the gap each frame, the same at any frame rate.
        const k = 1 - Math.exp(-2 * Math.min(dt, 0.05));
        camera.position.lerp(flight.position, k);
        controls.target.lerp(flight.target, k);
        if (camera.position.distanceTo(flight.position) < 0.3 && controls.target.distanceTo(flight.target) < 0.3) {
          camera.position.copy(flight.position);
          controls.target.copy(flight.target);
          flight = null;
        }
      }
      if (flying && (flyInput.forward || flyInput.right || flyInput.up)) {
        camera.getWorldDirection(forward);
        right.crossVectors(forward, camera.up).normalize();
        move
          .set(0, 0, 0)
          .addScaledVector(forward, flyInput.forward)
          .addScaledVector(right, flyInput.right)
          .addScaledVector(camera.up, flyInput.up)
          .multiplyScalar(FLY_SPEED * dt);
        camera.position.add(move);
        controls.target.add(move);
        const r = Math.hypot(camera.position.x, camera.position.z);
        if (r > FLY_RADIUS) {
          const back = (r - FLY_RADIUS) / r;
          move.set(-camera.position.x * back, 0, -camera.position.z * back);
          camera.position.add(move);
          controls.target.add(move);
        }
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
