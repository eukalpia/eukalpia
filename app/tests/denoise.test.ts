import { BoxGeometry, PerspectiveCamera, Vector3 } from 'three';
import { DENOISE_GLSL, DenoisePass, denoiseWeight } from '../src/phototrace/denoise';
import { focusDistance, saveName } from '../src/phototrace/focus';
import { createCollisionWorld } from '../src/world/collision';

test('edges keep their sharpness', () => {
  expect(denoiseWeight(0.9, 0, 0, 16)).toBeLessThan(0.05);
  expect(denoiseWeight(0, 0.2, 0, 16)).toBeLessThan(0.05);
});

test('flat noisy regions are smoothed', () => {
  expect(denoiseWeight(0, 0, 0.1, 16)).toBeGreaterThan(0.5);
});

test('the filter fades as samples converge', () => {
  expect(denoiseWeight(0, 0, 0.1, 256)).toBeLessThan(denoiseWeight(0, 0, 0.1, 16));
});

test('the GPU filter uses the same weight', () => {
  const pass = new DenoisePass(new PerspectiveCamera());
  expect(pass.filterMaterial.fragmentShader).toContain(DENOISE_GLSL);
  expect(DENOISE_GLSL).toContain('/*denoise:weight*/');
  expect(pass.needsDepthTexture).toBe(true);
  pass.dispose();
});

const camera = new PerspectiveCamera(50, 1, 0.1, 5000);
camera.position.set(0, 2, 0);
camera.lookAt(0, 2, -10);
camera.updateMatrixWorld();

test('clicking the sky focuses at infinity', () => {
  const empty = { raycast: () => null };
  const d = focusDistance(empty, camera, 0, 0.9);
  expect(d).toBe(Infinity);
});

test('clicking a wall focuses on it', () => {
  const wall = new BoxGeometry(40, 20, 1).translate(0, 10, -20.5).toNonIndexed();
  wall.deleteAttribute('uv');
  wall.deleteAttribute('normal');
  const world = createCollisionWorld(wall, [{ cx: 0, cz: 0, radius: 100, topY: 0 }]);
  expect(focusDistance(world, camera, 0, 0)).toBeCloseTo(20, 1);
});

test('saved frames get a sortable name', () => {
  expect(saveName(new Date('2026-10-12T12:30:05Z'))).toBe('eukalpia-2026-10-12T12-30-05.png');
});

test('focus distance never comes back as NaN', () => {
  const odd = { raycast: () => Number.NaN };
  expect(focusDistance(odd, camera, 0, 0)).toBe(Infinity);
  expect(Number.isNaN(focusDistance({ raycast: () => 5 }, camera, Number.NaN, 0))).toBe(false);
  void new Vector3();
});
