import { PerspectiveCamera } from 'three';
import { CloudPass } from '../src/engine/atmosphere/clouds';

test('clouds raymarch at half resolution', () => {
  const pass = new CloudPass(new PerspectiveCamera(), 'high');
  pass.setSize(1280, 720);
  expect(pass.target.width).toBe(640);
  expect(pass.target.height).toBe(360);
  pass.dispose();
});

test('clouds read scene depth and stop marching at the first surface', () => {
  const pass = new CloudPass(new PerspectiveCamera(), 'high');
  expect(pass.needsDepthTexture).toBe(true);
  expect(pass.marchMaterial.fragmentShader).toContain('/*clouds:scene-depth*/');
  pass.dispose();
});

test('the low tier keeps the cheap layered path', () => {
  const pass = new CloudPass(new PerspectiveCamera(), 'low');
  expect(pass.marchMaterial.defines.CLOUD_STEPS).toBe(0);
  pass.dispose();
});
