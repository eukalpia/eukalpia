import { DataTexture, PerspectiveCamera, Scene, Vector3 } from 'three';
import { EQUIRECT_GLSL, directionToEquirect, equirectDirection, equirectMaterial } from '../src/phototrace/environment';
import { PhotoInputPass } from '../src/phototrace/photoInputPass';

test('equirect directions follow three.js equirectUv', () => {
  // three: u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5
  expect(directionToEquirect(new Vector3(1, 0, 0))).toEqual([0.5, 0.5].map(x => expect.closeTo(x, 6)));
  expect(directionToEquirect(new Vector3(0, 1, 0))[1]).toBeCloseTo(1, 6);
  expect(directionToEquirect(new Vector3(0, 0, 1))[0]).toBeCloseTo(0.75, 6);
  for (const d of [new Vector3(0.3, 0.5, -0.8), new Vector3(-0.9, -0.2, 0.1), new Vector3(0.01, -0.99, 0.02)]) {
    d.normalize();
    const [u, v] = directionToEquirect(d);
    expect(equirectDirection(u, v, new Vector3()).distanceTo(d)).toBeLessThan(1e-6);
  }
});

test('the GPU conversion uses the same mapping', () => {
  const m = equirectMaterial();
  expect(m.fragmentShader).toContain(EQUIRECT_GLSL);
  expect(EQUIRECT_GLSL).toContain('/*equirect:direction*/');
  m.dispose();
});

test('photo input rasterises for depth, then shows the traced image', () => {
  const pass = new PhotoInputPass(new Scene(), new PerspectiveCamera());
  expect(pass.needsSwap).toBe(false);
  expect(pass.copyMaterial.fragmentShader).toContain('tPath');
  const tex = new DataTexture();
  pass.setPathTexture(tex);
  expect(pass.copyMaterial.uniforms.tPath.value).toBe(tex);
  expect(pass.copyMaterial.depthTest).toBe(false);
  expect(pass.copyMaterial.depthWrite).toBe(false);
  pass.dispose();
});
