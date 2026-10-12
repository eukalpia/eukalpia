import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three';
import { UR01_MATERIALS, upgradeCharacterMaterials } from '../src/character/materials';
import { fakeShader } from './helpers';

/** A stand-in for UR-01: one mesh per GLB material, each still carrying the GLB's textures. */
function fakeCharacter() {
  const root = new Group();
  for (const name of UR01_MATERIALS) {
    const material = new MeshPhysicalMaterial({
      name: `UR01 / ${name}`,
      color: 0x020202,
      map: new Texture(),
      normalMap: new Texture(),
      roughnessMap: new Texture(),
    });
    root.add(new Mesh(new BoxGeometry(), material));
  }
  return root;
}
const find = (root: Group, name: string) =>
  (root.children as Mesh[]).find(m => (m.material as MeshPhysicalMaterial).name.endsWith(name))!
    .material as MeshPhysicalMaterial;

test('the coat is charcoal wool with a sheen, not near-black noise', () => {
  const root = fakeCharacter();
  upgradeCharacterMaterials(root, { tier: 'high' });
  const wool = find(root, 'fabric');
  for (const c of [wool.color.r, wool.color.g, wool.color.b]) {
    // Black wool: 1.5–4 % albedo, far above the GLB's 0.2 %.
    expect(c).toBeGreaterThanOrEqual(0.015);
    expect(c).toBeLessThanOrEqual(0.04);
  }
  expect(wool.sheen).toBeGreaterThan(0);
  expect(wool.map).toBeNull();
  expect(wool.normalMap).toBeNull();
  expect(wool.roughnessMap).toBeNull();
});

test('every UR-01 material gets relief pinned to the bind pose', () => {
  const root = fakeCharacter();
  upgradeCharacterMaterials(root, { tier: 'high' });
  for (const name of UR01_MATERIALS) {
    const shader = fakeShader();
    find(root, name).onBeforeCompile(shader, undefined as never);
    expect(shader.vertexShader, name).toContain('/*ur01:bind*/');
    // Bind-pose coordinates come from the unskinned position, so the pattern does not swim when UR-01 moves.
    expect(shader.vertexShader).toContain('vUrBind = position');
    expect(shader.fragmentShader).toContain('/*ur01:relief*/');
  }
});

test('the visor is a polished, reflective shell', () => {
  const root = fakeCharacter();
  upgradeCharacterMaterials(root, { tier: 'high' });
  const visor = find(root, 'glass');
  expect(visor.clearcoat).toBe(1);
  expect(visor.roughness).toBeLessThanOrEqual(0.08);
});

test('metals are metal and the armour is a bright clear-coated ceramic', () => {
  const root = fakeCharacter();
  upgradeCharacterMaterials(root, { tier: 'high' });
  for (const m of ['copper', 'metal', 'darkmetal']) expect(find(root, m).metalness).toBe(1);
  const ceramic = find(root, 'ceramic');
  expect(ceramic.color.r).toBeGreaterThan(0.6);
  expect(ceramic.clearcoat).toBeGreaterThan(0.3);
});

test('the low tier keeps the looks but skips the relief', () => {
  const root = fakeCharacter();
  upgradeCharacterMaterials(root, { tier: 'low' });
  const shader = fakeShader();
  find(root, 'fabric').onBeforeCompile(shader, undefined as never);
  expect(shader.fragmentShader).not.toContain('/*ur01:relief*/');
  expect(find(root, 'fabric').color.r).toBeGreaterThanOrEqual(0.015);
});

test('materials that are not UR-01 are left alone', () => {
  const root = new Group();
  const other = new MeshStandardMaterial({ name: 'Street lamp' });
  root.add(new Mesh(new BoxGeometry(), other));
  upgradeCharacterMaterials(root, { tier: 'high' });
  expect(other.onBeforeCompile).toBe(MeshStandardMaterial.prototype.onBeforeCompile);
});

test('the hands of the coat mesh become black leather gloves', async () => {
  const { Bone, BufferAttribute, BoxGeometry, Skeleton, SkinnedMesh, Vector3 } = await import('three');
  const root = new Group();
  const pelvis = new Bone();
  pelvis.name = 'pelvis';
  const forearm = new Bone();
  forearm.name = 'forearmL';
  forearm.position.set(0.5, 1.3, 0);
  const hand = new Bone();
  hand.name = 'handL';
  hand.position.set(0.25, -0.05, 0);
  pelvis.add(forearm);
  forearm.add(hand);
  const g = new BoxGeometry(0.2, 0.2, 0.2);
  const n = g.getAttribute('position').count;
  g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(n * 4), 4));
  g.setAttribute(
    'skinWeight',
    new BufferAttribute(
      new Float32Array(n * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)),
      4,
    ),
  );
  const coat = new SkinnedMesh(g, new MeshPhysicalMaterial({ name: 'UR01 / fabric' }));
  coat.add(pelvis);
  root.add(coat);
  root.updateMatrixWorld(true);
  coat.bind(new Skeleton([pelvis, forearm, hand]));
  upgradeCharacterMaterials(root, { tier: 'high' });
  const shader = fakeShader();
  (coat.material as MeshPhysicalMaterial).onBeforeCompile(shader, undefined as never);
  expect(shader.fragmentShader).toContain('/*ur01:glove*/');
  const wrist = shader.uniforms.uUrWrist.value as InstanceType<typeof Vector3>[];
  expect(wrist[0].distanceTo(new Vector3(0.75, 1.25, 0))).toBeLessThan(1e-5);
  const dir = shader.uniforms.uUrHandDir.value as InstanceType<typeof Vector3>[];
  expect(dir[0].x).toBeGreaterThan(0.9);
});
