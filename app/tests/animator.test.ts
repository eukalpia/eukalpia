import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bone, Group, Quaternion, Vector3 } from 'three';
import { createAnimator } from '../src/character/animator';
import { UR01, boneKey, type BoneName, type CharacterModel } from '../src/character/model';

/** Rebuilds UR-01's skeleton from the GLB's JSON chunk, with names sanitised like GLTFLoader does. */
function ur01Skeleton(): CharacterModel {
  const b = readFileSync(join(__dirname, '../public/models/ur01/character.glb'));
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  const nodes = json.nodes.map((n: { name: string; translation?: number[]; rotation?: number[] }) => {
    const bone = new Bone();
    bone.name = n.name.replace(/[\[\]\.:\/]/g, '');
    bone.position.fromArray(n.translation ?? [0, 0, 0]);
    bone.quaternion.fromArray(n.rotation ?? [0, 0, 0, 1]);
    return bone;
  });
  json.nodes.forEach((n: { children?: number[] }, i: number) =>
    (n.children ?? []).forEach(c => nodes[i].add(nodes[c])),
  );
  const root = new Group();
  const rootBone = nodes.find((n: Bone) => n.name === 'root');
  root.add(rootBone);
  const bones = new Map<BoneName, Bone>();
  for (const name of UR01.bones) {
    const bone = nodes.find((n: Bone) => boneKey(n.name) === boneKey(name));
    if (bone) bones.set(name, bone);
  }
  return { root, skinned: [], bones, bindBounds: () => null as never, dispose() {} };
}

const world = (model: CharacterModel, name: BoneName) => {
  model.root.updateMatrixWorld(true);
  return new Vector3().setFromMatrixPosition(model.bones.get(name)!.matrixWorld);
};

test('GLTFLoader-sanitised names still resolve every UR-01 bone', () => {
  expect(boneKey('foot.L')).toBe(boneKey('footL'));
  expect(ur01Skeleton().bones.size).toBe(26);
});

test('walking swings the feet forward and back and never through the ground', () => {
  const model = ur01Skeleton();
  const anim = createAnimator(model);
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minY = Infinity;
  for (let i = 0; i < 120; i++) {
    anim.update(1 / 60, { speed: 1.6, grounded: true, verticalSpeed: 0, turnRate: 0, groundL: 0, groundR: 0 });
    const toe = world(model, 'toe.L');
    const ankle = world(model, 'foot.L');
    minZ = Math.min(minZ, ankle.z);
    maxZ = Math.max(maxZ, ankle.z);
    minY = Math.min(minY, toe.y);
  }
  expect(maxZ - minZ).toBeGreaterThan(0.35);
  expect(minY).toBeGreaterThan(-0.02);
});

test('standing idle keeps the feet planted where the bind pose has them', () => {
  const model = ur01Skeleton();
  const bindAnkle = world(model, 'foot.L');
  const anim = createAnimator(model);
  for (let i = 0; i < 60; i++)
    anim.update(1 / 60, { speed: 0, grounded: true, verticalSpeed: 0, turnRate: 0, groundL: 0, groundR: 0 });
  expect(world(model, 'foot.L').distanceTo(bindAnkle)).toBeLessThan(0.02);
});

test('the relaxed arms hang closer to the body than the A-pose', () => {
  const model = ur01Skeleton();
  const bindHand = world(model, 'hand.L');
  const anim = createAnimator(model);
  anim.update(1 / 60, { speed: 0, grounded: true, verticalSpeed: 0, turnRate: 0, groundL: 0, groundR: 0 });
  expect(Math.abs(world(model, 'hand.L').x)).toBeLessThan(Math.abs(bindHand.x) - 0.1);
});
void Quaternion;
