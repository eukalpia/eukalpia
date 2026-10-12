import {
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import { UR01, characterUrl, loadCharacter, measureBindPose, type CharacterModel } from '../src/character/model';

test('characterUrl picks the mobile file for the low tier', () => {
  expect(characterUrl('mobile', '/eukalpia/')).toBe('/eukalpia/models/ur01/character-mobile.glb');
  expect(characterUrl('desktop', '/eukalpia/')).toBe('/eukalpia/models/ur01/character.glb');
});

test('bone list matches the GLB rig', () => {
  expect(UR01.bones).toHaveLength(26);
  expect(UR01.bones).toContain('foot.L');
  expect(UR01.height).toBe(1.824);
});

function syntheticModel(): CharacterModel {
  // A 2 m column skinned to a two-bone chain.
  const geometry = new BoxGeometry(0.5, 2, 0.3, 1, 4, 1).translate(0, 1, 0);
  const pos = geometry.getAttribute('position');
  const idx: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    idx.push(pos.getY(i) > 1 ? 1 : 0, 0, 0, 0);
    w.push(1, 0, 0, 0);
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(w, 4));
  const root = new Bone();
  const upper = new Bone();
  upper.position.y = 1;
  root.add(upper);
  const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
  mesh.add(root);
  mesh.bind(new Skeleton([root, upper]));
  const group = new Group();
  group.add(mesh);
  return { root: group, skinned: [mesh], bones: new Map(), bindBounds: () => null as never, dispose() {} };
}

test('measureBindPose measures the rest pose and restores the animated pose', () => {
  const model = syntheticModel();
  const upper = model.skinned[0].skeleton.bones[1];
  upper.rotation.z = 1.2;
  const m = measureBindPose(model);
  expect(m.height).toBeCloseTo(2, 3);
  expect(m.widthRatio).toBeCloseTo(0.25, 3);
  expect(upper.rotation.z).toBeCloseTo(1.2, 6);
});

test('a failed load rejects with a readable message', async () => {
  await expect(loadCharacter('desktop', 'http://127.0.0.1:9/nowhere/')).rejects.toThrow(/UR-01 could not load/);
});
