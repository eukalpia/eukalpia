import { Matrix4, Vector3 } from 'three';
import { createBarkMaterial, createTrunkLod, TREE_LOD_NEAR, trunkGeometry } from '../src/world/street/trees';
import { fakeShader } from './helpers';

const radiusAt = (g: ReturnType<typeof trunkGeometry>, y: number) => {
  const pos = g.getAttribute('position');
  let best = 0;
  for (let i = 0; i < pos.count; i++)
    if (Math.abs(pos.getY(i) - y) < 0.12) best = Math.max(best, Math.hypot(pos.getX(i), pos.getZ(i)));
  return best;
};

test('the trunk is round (12 sides), flares at the roots and tapers upwards', () => {
  const g = trunkGeometry(7, 0.2, 7);
  const pos = g.getAttribute('position');
  const angles = new Set<number>();
  for (let i = 0; i < pos.count; i++)
    if (pos.getY(i) < 0.01) angles.add(Math.round((Math.atan2(pos.getZ(i), pos.getX(i)) * 180) / Math.PI / 5));
  expect(angles.size).toBeGreaterThanOrEqual(12);
  expect(radiusAt(g, 0)).toBeGreaterThan(radiusAt(g, 1.5) * 1.35);
  // Below the boughs, which start at about 3.3 m.
  expect(radiusAt(g, 2.5)).toBeLessThan(radiusAt(g, 1.5));
});

test('the trunk stands on the ground and reaches into the crown', () => {
  const g = trunkGeometry(7, 0.2, 7);
  g.computeBoundingBox();
  expect(g.boundingBox!.min.y).toBeCloseTo(0, 2);
  expect(g.boundingBox!.max.y).toBeGreaterThan(7 * 0.6);
});

test('bark has procedural fissures in instance space', () => {
  const m = createBarkMaterial();
  const shader = fakeShader();
  m.onBeforeCompile(shader, undefined as never);
  expect(shader.fragmentShader).toContain('/*bark*/');
  expect(shader.vertexShader).toContain('vBark = position');
  expect(m.color.r).toBeLessThan(0.2);
});

const triangles = (g: ReturnType<typeof trunkGeometry>) => g.index!.count / 3;

test('far trunks are a few dozen triangles, near ones keep the detail', () => {
  expect(triangles(trunkGeometry(7, 0.2, 7, 'far'))).toBeLessThanOrEqual(100);
  expect(triangles(trunkGeometry(7, 0.2, 7))).toBeGreaterThanOrEqual(300);
  const far = trunkGeometry(7, 0.2, 7, 'far');
  far.computeBoundingBox();
  expect(far.boundingBox!.min.y).toBeCloseTo(0, 2);
  expect(far.boundingBox!.max.y).toBeGreaterThan(7 * 0.6);
});

test('only trunks near the camera get the detailed geometry', () => {
  const matrices = Array.from({ length: 20 }, (_, i) => new Matrix4().makeTranslation(i * 10, 0, 0));
  const lod = createTrunkLod(
    trunkGeometry(7, 0.2, 1),
    trunkGeometry(7, 0.2, 1, 'far'),
    createBarkMaterial(),
    matrices,
    {
      name: 'tree-wood-0',
      castShadow: true,
    },
  );
  lod.update(new Vector3(0, 2, 0));
  expect(lod.near.count).toBe(matrices.filter((_, i) => i * 10 < TREE_LOD_NEAR).length);
  expect(lod.near.count + lod.far.count).toBe(20);
  lod.update(new Vector3(190, 2, 0));
  const p = new Vector3();
  const m = new Matrix4();
  lod.near.getMatrixAt(0, m);
  expect(p.setFromMatrixPosition(m).x).toBeGreaterThan(190 - TREE_LOD_NEAR);
  expect(lod.near.castShadow && lod.far.castShadow).toBe(true);
});
