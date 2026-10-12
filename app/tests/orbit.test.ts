import { PerspectiveCamera, Vector3 } from 'three';
import { CLOUD_TOP } from '../src/engine/atmosphere/clouds';
import {
  FLY_RADIUS,
  ORBIT_LIMITS,
  SHOT_PRESETS,
  UNDERWORLD_POSE,
  createOrbit,
  tourPose,
} from '../src/engine/camera/orbit';
import { fakeDom } from './helpers';

test('tour stays within orbit limits', () => {
  for (let t = 0; t < 600; t += 0.5) {
    const p = tourPose(t);
    expect(p.distance).toBeGreaterThanOrEqual(ORBIT_LIMITS.minDistance);
    expect(p.distance).toBeLessThanOrEqual(ORBIT_LIMITS.maxDistance);
    expect(p.polar).toBeLessThanOrEqual(ORBIT_LIMITS.maxPolarAngle);
  }
});

test('reduced motion disables the tour', () => {
  const o = createOrbit(new PerspectiveCamera(), fakeDom(), { reducedMotion: true });
  expect(o.tourActive).toBe(false);
});

test('tour starts without reduced motion and stops on pointer input', () => {
  const dom = fakeDom();
  const o = createOrbit(new PerspectiveCamera(), dom, { reducedMotion: false });
  expect(o.tourActive).toBe(true);
  dom.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
  expect(o.tourActive).toBe(false);
});

test('a shot preset freezes the camera exactly', () => {
  const camera = new PerspectiveCamera();
  const o = createOrbit(camera, fakeDom(), { reducedMotion: false });
  o.applyPreset('underside');
  o.update(0.5);
  expect(o.tourActive).toBe(false);
  expect(camera.position.toArray()).toEqual(SHOT_PRESETS.underside.position);
});

test('jumpTo holds the camera exactly at a pose, ending the tour and any flight (frame-by-frame capture)', () => {
  const camera = new PerspectiveCamera();
  const o = createOrbit(camera, fakeDom(), { reducedMotion: false });
  const tour: boolean[] = [];
  o.onTourChange(on => tour.push(on));
  o.flyTo([300, 120, 300], [0, 40, 0]);
  o.startTour();
  o.flyTo([300, 120, 300], [0, 40, 0]);
  o.jumpTo([640, 260, -420], [10, 60, 5]);
  for (let i = 0; i < 20; i++) o.update(0.1);
  expect(o.tourActive).toBe(false);
  expect(tour.at(-1)).toBe(false);
  expect(camera.position.toArray()).toEqual([640, 260, -420]);
  expect(o.controls.target.toArray()).toEqual([10, 60, 5]);
  const ahead = new Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  expect(ahead.angleTo(new Vector3(10, 60, 5).sub(camera.position))).toBeLessThan(1e-6);
});

test('the tour can be stopped from code (photo mode needs a still camera)', () => {
  const dom = fakeDom();
  const camera = new PerspectiveCamera();
  const orbit = createOrbit(camera, dom as unknown as HTMLElement, { reducedMotion: false });
  expect(orbit.tourActive).toBe(true);
  orbit.stopTour();
  expect(orbit.tourActive).toBe(false);
  const before = camera.position.clone();
  orbit.update(1);
  expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
  orbit.dispose();
});

test('flyTo eases the camera to a pose and ends the tour; reduced motion jumps there', () => {
  const camera = new PerspectiveCamera();
  const o = createOrbit(camera, fakeDom(), { reducedMotion: false });
  o.flyTo([300, 120, 300], [0, 40, 0]);
  expect(o.tourActive).toBe(false);
  o.update(0.05);
  const d1 = camera.position.distanceTo(new Vector3(300, 120, 300));
  expect(d1).toBeGreaterThan(5);
  for (let i = 0; i < 400; i++) o.update(0.05);
  expect(camera.position.distanceTo(new Vector3(300, 120, 300))).toBeLessThan(1);
  expect(o.controls.target.distanceTo(new Vector3(0, 40, 0))).toBeLessThan(1);
  const still = createOrbit(new PerspectiveCamera(), fakeDom(), { reducedMotion: true });
  still.flyTo([300, 120, 300], [0, 40, 0]);
  expect(still.controls.object.position.distanceTo(new Vector3(300, 120, 300))).toBeLessThan(1e-6);
});

test('the tour tells its listener when a drag ends it, and can be started again', () => {
  const dom = fakeDom();
  const o = createOrbit(new PerspectiveCamera(), dom, { reducedMotion: false });
  const seen: boolean[] = [];
  o.onTourChange(on => seen.push(on));
  dom.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
  o.startTour();
  expect(o.tourActive).toBe(true);
  expect(seen).toEqual([false, true]);
});

test('while paused the tour holds still', () => {
  const camera = new PerspectiveCamera();
  const o = createOrbit(camera, fakeDom(), { reducedMotion: false });
  o.setPaused(true);
  const before = camera.position.clone();
  o.update(2);
  expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
  o.setPaused(false);
  o.update(2);
  expect(camera.position.distanceTo(before)).toBeGreaterThan(1e-3);
});

test('free flight moves along the view, rises and sinks, and stays inside the sky', () => {
  const camera = new PerspectiveCamera();
  const o = createOrbit(camera, fakeDom(), { reducedMotion: true });
  o.flyTo([0, 100, 400], [0, 100, 0]);
  o.setFly(true);
  o.setFlyInput({ forward: 1, right: 0, up: 0 });
  o.update(1);
  expect(camera.position.z).toBeLessThan(400 - 20);
  expect(camera.position.y).toBeCloseTo(100, 0);
  o.setFlyInput({ forward: 0, right: 0, up: 1 });
  o.update(1);
  expect(camera.position.y).toBeGreaterThan(110);
  o.setFlyInput({ forward: -1, right: 0, up: 0 });
  for (let i = 0; i < 400; i++) o.update(1);
  expect(Math.hypot(camera.position.x, camera.position.z)).toBeLessThanOrEqual(FLY_RADIUS + 1e-6);
  o.setFly(false);
  o.setFlyInput({ forward: 1, right: 0, up: 0 });
  const before = camera.position.clone();
  o.update(1);
  expect(camera.position.distanceTo(before)).toBeLessThan(1e-6);
});

test('following a moving target keeps the camera at its offset until a drag lets go', () => {
  const dom = fakeDom();
  const camera = new PerspectiveCamera();
  const o = createOrbit(camera, dom, { reducedMotion: true });
  const pod = new Vector3(100, 80, 0);
  o.follow(() => pod);
  expect(o.tourActive).toBe(false);
  for (let i = 0; i < 200; i++) o.update(0.05);
  const offset = camera.position.clone().sub(pod);
  expect(o.controls.target.distanceTo(pod)).toBeLessThan(1);
  pod.set(200, 80, 50);
  for (let i = 0; i < 200; i++) o.update(0.05);
  expect(o.controls.target.distanceTo(pod)).toBeLessThan(1);
  expect(camera.position.clone().sub(pod).distanceTo(offset)).toBeLessThan(1);
  dom.dispatch('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 });
  pod.set(400, 80, 50);
  o.update(0.05);
  expect(o.controls.target.distanceTo(pod)).toBeGreaterThan(100);
});

test('floor −1 looks up at the roots from clear air above the cloud deck, not from inside it', () => {
  const [, y] = UNDERWORLD_POSE.position;
  expect(y).toBeGreaterThan(CLOUD_TOP + 20);
  expect(y).toBeLessThan(UNDERWORLD_POSE.target[1]);
});
