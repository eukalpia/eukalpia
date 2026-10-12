import { PerspectiveCamera, Vector3 } from 'three';
import { LightShaftsPass, shaftMask, shaftStrength } from '../src/engine/atmosphere/lightShafts';

test('only open sky emits shafts: anything with depth in front of the far plane blocks them', () => {
  expect(shaftMask(0.5, 1)).toBe(0);
  expect(shaftMask(0.99, 1)).toBe(0);
  expect(shaftMask(1, 1)).toBeGreaterThan(0.5);
  // Sky far from the sun hardly emits.
  expect(shaftMask(1, 0.2)).toBeLessThan(0.05);
});

test('shafts fade out when the sun is behind the camera or high in the sky', () => {
  const forward = new Vector3(0, 0, -1);
  const low = (az: number) => new Vector3(Math.sin(az), Math.sin((15 * Math.PI) / 180), -Math.cos(az)).normalize();
  expect(shaftStrength(low(0), forward)).toBeGreaterThan(0.5);
  expect(shaftStrength(low(Math.PI), forward)).toBe(0);
  const high = new Vector3(0, Math.sin((70 * Math.PI) / 180), -Math.cos((70 * Math.PI) / 180));
  expect(shaftStrength(high, forward)).toBeLessThan(0.1);
});

test('the pass reads scene depth and blurs towards the sun', () => {
  const pass = new LightShaftsPass(new PerspectiveCamera(), 'high');
  expect(pass.needsDepthTexture).toBe(true);
  expect(pass.blurMaterial.fragmentShader).toContain('/*shafts:radial*/');
  expect(pass.blurMaterial.defines.SHAFT_SAMPLES).toBeGreaterThanOrEqual(32);
  pass.dispose();
});

test('the low tier has no shafts', () => {
  const pass = new LightShaftsPass(new PerspectiveCamera(), 'low');
  expect(pass.enabled).toBe(false);
  pass.dispose();
});
