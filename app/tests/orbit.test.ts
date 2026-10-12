import { PerspectiveCamera } from 'three';
import { ORBIT_LIMITS, SHOT_PRESETS, createOrbit, tourPose } from '../src/engine/camera/orbit';
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
