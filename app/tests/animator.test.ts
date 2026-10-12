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

const idle = { speed: 0, grounded: true, verticalSpeed: 0, turnRate: 0, groundL: 0, groundR: 0 };

test('standing still, UR-01 shifts weight from foot to foot every few seconds', () => {
  const model = ur01Skeleton();
  const anim = createAnimator(model);
  const xs: number[] = [];
  for (let i = 0; i < 20 * 60; i++) {
    anim.update(1 / 60, idle);
    if (i % 6 === 0) xs.push(world(model, 'pelvis').x);
  }
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const range = Math.max(...xs) - Math.min(...xs);
  expect(range).toBeGreaterThan(0.01);
  expect(range).toBeLessThan(0.05);
  let crossings = 0;
  for (let i = 1; i < xs.length; i++) if (Math.sign(xs[i] - mean) !== Math.sign(xs[i - 1] - mean)) crossings++;
  expect(crossings).toBeGreaterThanOrEqual(4);
  expect(crossings).toBeLessThanOrEqual(12);
});

test('the weight shift keeps both feet planted', () => {
  const model = ur01Skeleton();
  const anim = createAnimator(model);
  anim.update(1 / 60, idle);
  const startL = world(model, 'foot.L');
  const startR = world(model, 'foot.R');
  let drift = 0;
  for (let i = 0; i < 12 * 60; i++) {
    anim.update(1 / 60, idle);
    drift = Math.max(drift, world(model, 'foot.L').distanceTo(startL), world(model, 'foot.R').distanceTo(startR));
  }
  expect(drift).toBeLessThan(0.015);
});

test('now and then the head turns to look around', () => {
  const model = ur01Skeleton();
  const anim = createAnimator(model);
  const head = model.bones.get('head')!;
  const forward = () => {
    model.root.updateMatrixWorld(true);
    return new Vector3(0, 0, 1).applyQuaternion(head.getWorldQuaternion(new Quaternion()));
  };
  anim.update(1 / 60, idle);
  const rest = forward();
  let widest = 0;
  for (let i = 0; i < 30 * 60; i++) {
    anim.update(1 / 60, idle);
    if (i % 10 === 0) widest = Math.max(widest, forward().angleTo(rest));
  }
  expect(widest).toBeGreaterThan(0.12);
  expect(widest).toBeLessThan(0.6);
});

test('coat tails swing on a spring and settle after a sudden stop', () => {
  const model = ur01Skeleton();
  const anim = createAnimator(model);
  const coat = model.bones.get('coat.L')!;
  for (let i = 0; i < 2 * 60; i++) anim.update(1 / 60, { ...idle, speed: 4.2 });
  const samples: Quaternion[] = [];
  for (let i = 0; i < 2 * 60; i++) {
    anim.update(1 / 60, idle);
    samples.push(coat.quaternion.clone());
  }
  // Still moving a little right after the stop (inertia), at rest by the end.
  expect(samples[6].angleTo(samples[12])).toBeGreaterThan(0.005);
  expect(samples.at(-20)!.angleTo(samples.at(-1)!)).toBeLessThan(0.01);
});
