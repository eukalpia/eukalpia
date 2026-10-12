import { PRESETS, sunDirection } from '../src/engine/lighting/timeOfDay';

test('sun direction is unit and above horizon for both presets', () => {
  for (const t of ['day', 'night'] as const) {
    const d = sunDirection(PRESETS[t]);
    expect(d.length()).toBeCloseTo(1);
    expect(d.y).toBeGreaterThan(0.3);
  }
});

test('night lights more windows than day', () =>
  expect(PRESETS.night.windowLitRatio).toBeGreaterThan(PRESETS.day.windowLitRatio));

test('azimuth 180 points the light from the south (+z)', () => {
  const d = sunDirection({ ...PRESETS.day, sunAzimuthDeg: 180, sunElevationDeg: 0 });
  expect(d.z).toBeCloseTo(1);
  expect(d.x).toBeCloseTo(0);
});

test('daytime bloom only catches highlights above diffuse white', () => {
  // A threshold under ~1.5 lets sunlit clouds and sky bloom and veils the whole frame.
  expect(PRESETS.day.bloomThreshold).toBeGreaterThan(1.5);
  expect(PRESETS.day.bloomIntensity).toBeLessThan(PRESETS.night.bloomIntensity);
});

test('golden hour has light shafts; the moon only a faint hint', () => {
  expect(PRESETS.day.shafts).toBeGreaterThan(0.5);
  expect(PRESETS.night.shafts).toBeLessThan(0.2);
});
