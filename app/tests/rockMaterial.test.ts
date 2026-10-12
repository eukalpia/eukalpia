import { Texture, Vector3 } from 'three';
import { createRockMaterial, whiteoutBlend } from '../src/world/islands/rockMaterial';
import { fakeShader } from './helpers';

const flat = new Vector3(0, 0, 1);

test.each([
  [0, -1, 0],
  [-1, 0, 0],
  [-0.6, -0.8, 0],
  [0.3, 0.5, -0.81],
])('flat normal maps keep the geometric normal (%f, %f, %f)', (x, y, z) => {
  const n = new Vector3(x, y, z).normalize();
  const out = whiteoutBlend(n, flat, flat, flat);
  expect(out.dot(n)).toBeGreaterThan(0.999);
});

test('the shader uses the same blend', () => {
  const t = new Texture();
  const m = createRockMaterial({ map: t, normalMap: t, armMap: t });
  const shader = fakeShader();
  m.onBeforeCompile(shader, null as never);
  expect(shader.fragmentShader).toContain('abs(tx.z) * rN.x');
  expect(shader.fragmentShader).toContain('abs(ty.z) * rN.y');
  expect(shader.fragmentShader).toContain('abs(tz.z) * rN.z');
});
