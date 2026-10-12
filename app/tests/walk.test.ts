import { BoxGeometry, BufferGeometry, PerspectiveCamera, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWalkCameras } from '../src/character/cameras';
import { createInput } from '../src/character/input';
import { createCollisionWorld } from '../src/world/collision';
import { fakeDom } from './helpers';

test('releasing focus clears held keys', () => {
  const target = fakeDom();
  const input = createInput(target as never);
  target.dispatch('keydown', { code: 'KeyW', key: 'w' });
  target.dispatch('keydown', { code: 'ShiftLeft', key: 'Shift' });
  expect(input.state().forward).toBe(1);
  expect(input.state().run).toBe(true);
  target.dispatch('blur');
  expect(input.state().forward).toBe(0);
  expect(input.state().run).toBe(false);
  input.dispose();
});

test('typing in a text field does not move the character', () => {
  const target = fakeDom();
  const input = createInput(target as never);
  target.dispatch('keydown', { code: 'KeyW', key: 'w', target: { tagName: 'INPUT' } });
  expect(input.state().forward).toBe(0);
  input.dispose();
});

test('the third-person boom shortens at a wall', () => {
  const g: BufferGeometry = new BoxGeometry(20, 10, 1).translate(0, 5, 2.5).toNonIndexed();
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const world = createCollisionWorld(mergeGeometries([g]), [{ cx: 0, cz: 0, radius: 50, topY: 0 }]);
  const camera = new PerspectiveCamera(55, 1.6, 0.1, 5000);
  const cams = createWalkCameras(camera, world);
  // Character at the origin looking down −z: the boom extends towards +z and meets the wall at z = 2.
  for (let i = 0; i < 120; i++) cams.update(1 / 60, new Vector3(0, 0, 0), 0, 0);
  const head = new Vector3(0, 1.6, 0);
  expect(camera.position.distanceTo(head)).toBeLessThanOrEqual(1.8 + 1e-3);
  expect(camera.position.z).toBeLessThan(2);
});

test('first person puts the eye at 1.68 m', () => {
  const world = createCollisionWorld(
    mergeGeometries(
      [new BoxGeometry(1, 1, 1).toNonIndexed()].map(g => (g.deleteAttribute('uv'), g.deleteAttribute('normal'), g)),
    ),
    [],
  );
  const camera = new PerspectiveCamera();
  const cams = createWalkCameras(camera, world);
  cams.toggle();
  cams.update(1 / 60, new Vector3(5, 0, 5), 0, 0);
  expect(camera.position.y).toBeCloseTo(1.68, 3);
  expect(camera.fov).toBe(70);
});
