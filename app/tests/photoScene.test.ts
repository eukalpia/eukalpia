import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type Material,
} from 'three';
import { DISTRICTS } from '../src/content/districts';
import { buildPhotoScene, type PhotoSceneOptions } from '../src/phototrace/photoScene';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';

const layout = createLayout(DEFAULT_SEED, DISTRICTS);
const camera = new PerspectiveCamera();
camera.position.set(0, 2, 0);
const options = (night = false, lampHeads = new Float32Array()): PhotoSceneOptions => ({
  night,
  litRatio: night ? 0.28 : 0.04,
  layout,
  camera,
  lampLights: 4,
  lampHeads,
  sun: { direction: new Vector3(0.3, 0.6, 0.2).normalize(), color: new Color(1, 0.9, 0.8), intensity: 5 },
});
const meshes = (root: { traverse(fn: (o: unknown) => void): void }) => {
  const out: Mesh[] = [];
  root.traverse(o => (o as Mesh).isMesh && out.push(o as Mesh));
  return out;
};
const materials = (root: { traverse(fn: (o: unknown) => void): void }) =>
  meshes(root).flatMap(m => (Array.isArray(m.material) ? m.material : [m.material])) as Material[];

/** One wall quad 6 m wide and 12 m tall (three floors of 4 m), as the building builder writes it. */
function wall(style: number): Mesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 6, 0, 0, 6, 12, 0, 0, 12, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 6, 0, 6, 12, 0, 12]), 2));
  g.setAttribute('aBuilding', new BufferAttribute(new Float32Array(Array(4).fill([0.25, style, 4, 3]).flat()), 4));
  g.setAttribute('aBays', new BufferAttribute(new Float32Array([2, 2, 2, 2]), 1));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const m = new Mesh(g, new MeshStandardMaterial());
  m.material.onBeforeCompile = () => {};
  m.userData.photo = 'facade';
  return m;
}

test('instances become one merged mesh with every instance placed', () => {
  const inst = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial(), 3);
  [0, 10, 20].forEach((x, i) => inst.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, 0)));
  const photo = buildPhotoScene([inst], options());
  const out = meshes(photo.scene);
  expect(out).toHaveLength(1);
  expect(photo.triangles).toBe(36);
  out[0].geometry.computeBoundingBox();
  expect(out[0].geometry.boundingBox!.min.x).toBeCloseTo(-0.5, 5);
  expect(out[0].geometry.boundingBox!.max.x).toBeCloseTo(20.5, 5);
});

test('instance colours survive as vertex colours', () => {
  const inst = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial(), 2);
  inst.setMatrixAt(0, new Matrix4());
  inst.setMatrixAt(1, new Matrix4().makeTranslation(5, 0, 0));
  inst.setColorAt(0, new Color(1, 0, 0));
  inst.setColorAt(1, new Color(0, 0, 1));
  const [out] = meshes(buildPhotoScene([inst], options()).scene);
  expect((out.material as MeshStandardMaterial).vertexColors).toBe(true);
  const c = out.geometry.getAttribute('color');
  expect([c.getX(0), c.getZ(0)]).toEqual([1, 0]);
  expect([c.getX(c.count - 1), c.getZ(c.count - 1)]).toEqual([0, 1]);
});

test('custom shaders are replaced by standard materials', () => {
  const group = new Group();
  const trim = new Mesh(wall(0).geometry, new MeshStandardMaterial());
  trim.userData.photo = 'trim';
  const sky = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  sky.userData.photo = 'skip';
  group.add(wall(1), trim, sky);
  const all = materials(buildPhotoScene([group], options()).scene);
  expect(all.length).toBeGreaterThan(0);
  for (const m of all) {
    expect((m as MeshStandardMaterial).isMeshStandardMaterial).toBe(true);
    expect(m.onBeforeCompile).toBe(MeshStandardMaterial.prototype.onBeforeCompile);
  }
});

test('the ground floor is split off onto the storefront strip', () => {
  const out = meshes(buildPhotoScene([wall(0)], options()).scene);
  expect(out).toHaveLength(2);
  const ground = out.find(m => m.name.endsWith(':ground'))!;
  const pos = ground.geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeLessThanOrEqual(4 + 1e-6);
  const uv = ground.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) expect(uv.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
});

test('the night scene has light: glowing windows and the nearest lamps', () => {
  const heads = new Float32Array([0, 7, 1, 0, 7, 50, 3, 7, 3, 900, 7, 0, 5, 7, 5, 400, 7, 400, 2, 7, 9]);
  const photo = buildPhotoScene([wall(3)], options(true, heads));
  expect(materials(photo.scene).some(m => (m as MeshStandardMaterial).emissiveMap)).toBe(true);
  const lamps: PointLight[] = [];
  photo.scene.traverse(o => (o as PointLight).isPointLight && lamps.push(o as PointLight));
  expect(lamps).toHaveLength(4);
  for (const l of lamps) expect(l.position.distanceTo(camera.position)).toBeLessThan(12);
});

test('by day the sun is the only light', () => {
  const photo = buildPhotoScene([wall(0)], options());
  let point = 0;
  let directional = 0;
  photo.scene.traverse(o => {
    if ((o as PointLight).isPointLight) point++;
    if ((o as { isDirectionalLight?: boolean }).isDirectionalLight) directional++;
  });
  expect([point, directional]).toEqual([0, 1]);
});

test('a skinned character is baked in its pose', () => {
  const root = new Bone();
  const arm = new Bone();
  arm.position.y = 1;
  root.add(arm);
  const g = new BoxGeometry(0.2, 2, 0.2, 1, 4, 1).translate(0, 1, 0);
  const pos = g.getAttribute('position');
  const index = new Uint16Array(pos.count * 4);
  const weight = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    index[i * 4] = pos.getY(i) > 1 ? 1 : 0;
    weight[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new BufferAttribute(index, 4));
  g.setAttribute('skinWeight', new BufferAttribute(weight, 4));
  const mesh = new SkinnedMesh(g, new MeshStandardMaterial());
  mesh.add(root);
  mesh.bind(new Skeleton([root, arm]));
  arm.rotation.z = Math.PI / 2;
  mesh.updateMatrixWorld(true);
  const [out] = meshes(buildPhotoScene([mesh], options()).scene);
  const baked = out.geometry.getAttribute('position');
  const expected = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    mesh.getVertexPosition(i, expected).applyMatrix4(mesh.matrixWorld);
    expect(Math.abs(baked.getX(i) - expected.x) + Math.abs(baked.getY(i) - expected.y)).toBeLessThan(1e-4);
  }
});

test('dispose frees what the builder made', () => {
  const photo = buildPhotoScene([wall(2)], options(true));
  const disposed: string[] = [];
  for (const m of meshes(photo.scene)) m.geometry.addEventListener('dispose', () => disposed.push(m.name));
  photo.dispose();
  expect(disposed.length).toBe(meshes(photo.scene).length);
});

test('city meshes tell the photo builder what they are', async () => {
  const { createCityMeshes } = await import('../src/world/city');
  const { fakeTextures } = await import('./helpers');
  const sun = { setupMaterial() {} } as unknown as Parameters<typeof createCityMeshes>[2]['sun'];
  const city = createCityMeshes(layout, DISTRICTS, { tier: 'low', sun, textures: fakeTextures() });
  const roles = new Map<string, string>();
  city.group.traverse(o => {
    const m = o as Mesh;
    if (m.isMesh && !Array.isArray(m.material)) roles.set((m.material as Material).name, m.userData.photo);
  });
  expect(roles.get('Facade')).toBe('facade');
  expect(roles.get('Trim')).toBe('trim');
  expect(roles.get('Roof')).toBe('roof');
  city.dispose();
});

test('cars are split into paint, glass, tyres, chrome and lenses for the path tracer', async () => {
  const { createCarFleet } = await import('../src/world/street/cars');
  const fleet = createCarFleet([{ kind: 'sedan', color: 0xaa2222, matrix: new Matrix4() }], { castShadow: false });
  fleet.update(new Vector3());
  const group = new Group();
  group.add(...fleet.meshes);
  const out = meshes(buildPhotoScene([group], options()).scene);
  const byName = (part: string) => out.find(m => m.name.endsWith(`:${part}`));
  for (const part of ['paint', 'glass', 'tyre', 'chrome', 'lens', 'plate', 'tail'])
    expect(byName(part), part).toBeTruthy();
  // Number plates are matte, light and not metal.
  const plate = byName('plate')!.material as MeshStandardMaterial;
  expect(plate.color.r).toBeGreaterThan(0.6);
  expect(plate.metalness).toBe(0);
  expect(plate.roughness).toBeGreaterThan(0.3);
  const tail = byName('tail')!.material as MeshStandardMaterial;
  expect(tail.color.r).toBeGreaterThan(tail.color.g * 5);
  const glass = byName('glass')!.material as MeshStandardMaterial;
  expect(glass.roughness).toBeLessThan(0.1);
  const paint = byName('paint')!.material as MeshStandardMaterial;
  expect(paint.vertexColors).toBe(true);
  const c = byName('paint')!.geometry.getAttribute('color');
  expect(c.getX(0)).toBeGreaterThan(c.getZ(0));
  fleet.dispose();
});
