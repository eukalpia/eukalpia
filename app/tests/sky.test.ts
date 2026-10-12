import type { ShaderMaterial } from 'three';
import { BELOW_TINT, belowHorizon, createSky } from '../src/engine/lighting/sky';

test('looking down through the cloud gaps, the sky turns from horizon haze to a deep blue', () => {
  expect(belowHorizon(0.2)).toBe(0);
  expect(belowHorizon(0)).toBe(0);
  expect(belowHorizon(-0.1)).toBeGreaterThan(0.2);
  expect(belowHorizon(-0.3)).toBe(1);
  // Darker than the horizon, and bluer.
  expect(Math.max(...BELOW_TINT)).toBeLessThan(0.7);
  expect(BELOW_TINT[2]).toBeGreaterThan(BELOW_TINT[0] * 1.4);
});

test('the day sky shader carries the below-horizon tint', () => {
  const sky = createSky();
  sky.setPreset({ sunElevationDeg: 18, sunAzimuthDeg: 238, turbidity: 3, rayleigh: 1.5 } as never, 'day');
  const fragment = (sky.mesh.material as ShaderMaterial).fragmentShader;
  expect(fragment).toContain('/*sky:below*/');
  expect(fragment.indexOf('/*sky:below*/')).toBeLessThan(fragment.indexOf('gl_FragColor = vec4( texColor, 1.0 );'));
  sky.dispose();
});
