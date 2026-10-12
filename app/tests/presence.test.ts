import { Bone, Group, PerspectiveCamera, SpotLight, Vector3 } from 'three';
import type { BoneName, CharacterModel } from '../src/character/model';
import { createPresence } from '../src/character/presence';

function fakeModel(): CharacterModel {
  const root = new Group();
  const bones = new Map<BoneName, Bone>();
  for (const [name, x, y, z] of [
    ['pelvis', 0, 1, 0],
    ['foot.L', 0.12, 0.09, 0.05],
    ['foot.R', -0.12, 0.09, -0.05],
    ['chest', 0, 1.3, 0],
  ] as const) {
    const b = new Bone();
    b.position.set(x, y, z);
    root.add(b);
    bones.set(name, b);
  }
  root.position.set(10, 2, -4);
  return { root, skinned: [], bones, bindBounds: () => null as never, dispose() {} };
}

test('contact shadows sit under each foot, just above the ground', () => {
  const model = fakeModel();
  const presence = createPresence(model);
  const camera = new PerspectiveCamera();
  camera.position.set(10, 3, 0);
  presence.update(camera, false);
  const [left, right] = presence.feet;
  expect(left.position.x).toBeCloseTo(10.12, 2);
  expect(left.position.z).toBeCloseTo(-3.95, 2);
  expect(right.position.x).toBeCloseTo(9.88, 2);
  expect(left.position.y).toBeGreaterThan(2);
  expect(left.position.y).toBeLessThan(2.03);
  presence.dispose();
});

test('a lifted foot leaves a fainter shadow', () => {
  const model = fakeModel();
  const presence = createPresence(model);
  const camera = new PerspectiveCamera();
  presence.update(camera, false);
  const planted = presence.opacity(0);
  model.bones.get('foot.L')!.position.y = 0.5;
  presence.update(camera, false);
  expect(presence.opacity(0)).toBeLessThan(planted * 0.6);
  presence.dispose();
});

test('the close-up light stays on at night', () => {
  const camera = new PerspectiveCamera();
  camera.position.set(10, 3.5, 0);
  const presence = createPresence(fakeModel());
  presence.update(camera, true);
  const light = presence.group.children.find(o => (o as SpotLight).isSpotLight) as SpotLight;
  expect(light.intensity).toBeGreaterThan(0);
  presence.dispose();
});

test('the light fades out when the camera is far away', () => {
  const presence = createPresence(fakeModel());
  const camera = new PerspectiveCamera();
  camera.position.copy(new Vector3(10, 400, 600));
  presence.update(camera, false);
  const light = presence.group.children.find(o => (o as SpotLight).isSpotLight) as SpotLight;
  expect(light.intensity).toBe(0);
  presence.dispose();
});

test('the close-up lights cast no shadows: three would draw every caster in their cone', () => {
  // A shadow-casting spot light here drew whole instanced streets (all trees, all parked cars) into
  // its map each frame; UR-01's self-shadowing comes from the sun's cascades instead.
  const presence = createPresence(fakeModel());
  const lights = presence.group.children.filter(o => (o as SpotLight).isSpotLight) as SpotLight[];
  expect(lights.length).toBeGreaterThanOrEqual(2);
  for (const light of lights) expect(light.castShadow).toBe(false);
  presence.dispose();
});
