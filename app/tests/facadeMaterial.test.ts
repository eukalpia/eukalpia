import { createFacadeMaterial } from '../src/world/buildings/facadeMaterial';
import { fakeShader, fakeTextures } from './helpers';

test('facade shader injects window grid, interior and night code', () => {
  const m = createFacadeMaterial({ tier: 'high', textures: fakeTextures() });
  const shader = fakeShader();
  m.onBeforeCompile(shader, null as never);
  expect(shader.fragmentShader).toContain('/*facade:windows*/');
  expect(shader.fragmentShader).toContain('/*facade:interior*/');
  expect(shader.fragmentShader).toContain('/*facade:furniture*/');
  expect(shader.vertexShader).toContain('attribute vec4 aBuilding;');
  expect(shader.uniforms.uNight).toBe(m.uniforms.uNight);
});

test('low tier skips furniture', () => {
  const m = createFacadeMaterial({ tier: 'low', textures: fakeTextures() });
  const shader = fakeShader();
  m.onBeforeCompile(shader, null as never);
  expect(shader.fragmentShader).not.toContain('/*facade:furniture*/');
});

test('program cache key depends on tier', () => {
  const hi = createFacadeMaterial({ tier: 'high', textures: fakeTextures() });
  const lo = createFacadeMaterial({ tier: 'low', textures: fakeTextures() });
  expect(hi.customProgramCacheKey()).toBe('facade-high');
  expect(lo.customProgramCacheKey()).toBe('facade-low');
});

test('every injection point exists in the standard shader', () => {
  const m = createFacadeMaterial({ tier: 'high', textures: fakeTextures() });
  const shader = fakeShader();
  const before = shader.fragmentShader;
  m.onBeforeCompile(shader, null as never);
  for (const marker of ['/*facade:normal*/', '/*facade:emissive*/', '/*facade:surface*/', '/*facade:ao*/'])
    expect(shader.fragmentShader).toContain(marker);
  expect(shader.fragmentShader.length).toBeGreaterThan(before.length);
});
