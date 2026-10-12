import {
  LIT_ROOM_MEAN,
  NIGHT_ROOM_SCALE,
  ROOM_BRIGHTNESS_MEAN,
  ROOM_LIGHTS,
  createFacadeMaterial,
  roomBrightness,
} from '../src/world/buildings/facadeMaterial';
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

test('far-away windows glow with the same mean energy as near rooms', () => {
  const m = createFacadeMaterial({ tier: 'high', textures: fakeTextures() });
  const shader = fakeShader();
  m.onBeforeCompile(shader, null as never);
  expect(shader.fragmentShader).toContain(`LIT_ROOM_MEAN ${LIT_ROOM_MEAN.toFixed(3)}`);
  expect(shader.fragmentShader).toContain('/*facade:farlit*/');
  expect(shader.fragmentShader).toContain('LIT_ROOM_MEAN * NIGHT_ROOM_SCALE * fFarLit');
});

test('lit rooms are scaled the same near and far, so night windows glow instead of blowing out white', () => {
  const m = createFacadeMaterial({ tier: 'high', textures: fakeTextures() });
  const shader = fakeShader();
  m.onBeforeCompile(shader, null as never);
  expect(NIGHT_ROOM_SCALE).toBeLessThan(0.7);
  expect(shader.fragmentShader).toContain(`NIGHT_ROOM_SCALE ${NIGHT_ROOM_SCALE.toFixed(3)}`);
  expect(shader.fragmentShader).toContain('nightLight * NIGHT_ROOM_SCALE');
});

test('night rooms vary like a real facade: most dim and warm, a few bright offices', () => {
  expect(roomBrightness(0)).toBeLessThanOrEqual(0.35);
  expect(roomBrightness(0.5)).toBeLessThan(1.1);
  expect(roomBrightness(1)).toBeGreaterThanOrEqual(2.8);
  // The far-window average is the mean of the near distribution, so the two meet without a band.
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += roomBrightness((i + 0.5) / 1000);
  expect(sum / 1000).toBeCloseTo(ROOM_BRIGHTNESS_MEAN, 2);
  // Most lamps are warm; tungsten is clearly orange, not white.
  const warm = ROOM_LIGHTS.filter(l => l.color[2] < l.color[0] * 0.7);
  expect(warm.reduce((s, l) => s + l.share, 0)).toBeGreaterThan(0.75);
  expect(ROOM_LIGHTS[0].color[2]).toBeLessThan(0.4);
  expect(ROOM_LIGHTS.reduce((s, l) => s + l.share, 0)).toBeCloseTo(1, 6);
  const m = createFacadeMaterial({ tier: 'high', textures: fakeTextures() });
  const shader = fakeShader();
  m.onBeforeCompile(shader, null as never);
  expect(shader.fragmentShader).toContain('/*facade:room-brightness*/');
});

test('a window tint colours the lamps behind every window (override turns them red)', () => {
  const m = createFacadeMaterial({ tier: 'high', textures: fakeTextures() });
  const shader = fakeShader();
  m.onBeforeCompile(shader, null as never);
  expect(m.uniforms.uWindowTint.value.toArray()).toEqual([1, 1, 1]);
  expect(shader.uniforms.uWindowTint).toBe(m.uniforms.uWindowTint);
  expect(shader.fragmentShader).toMatch(/fLightColor[\s\S]*uWindowTint/);
});
