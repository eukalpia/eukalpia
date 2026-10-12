import { AdaptiveResolution, BUDGETS, TIER_SETTINGS, detectTier, readDeviceInfo } from '../src/engine/quality';

test('mobile is low', () =>
  expect(detectTier({ mobile: true, cores: 8, renderer: 'Apple GPU', screenArea: 3e5 })).toBe('low'));

test('integrated GPU is medium', () =>
  expect(detectTier({ mobile: false, cores: 8, renderer: 'ANGLE (Intel, Iris Xe)', screenArea: 2e6 })).toBe('medium'));

test('few cores is medium', () =>
  expect(detectTier({ mobile: false, cores: 4, renderer: 'ANGLE (NVIDIA, RTX 3060)', screenArea: 2e6 })).toBe(
    'medium',
  ));

test('discrete GPU is high', () =>
  expect(detectTier({ mobile: false, cores: 12, renderer: 'ANGLE (NVIDIA, RTX 3060)', screenArea: 2e6 })).toBe('high'));

test('slow frames lower DPR in 0.15 steps down to 0.6', () => {
  const a = new AdaptiveResolution(2);
  let dpr = 2;
  const seen: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const r = a.update(40, 1 / 25);
    if (r !== null) {
      dpr = r;
      seen.push(r);
    }
  }
  expect(dpr).toBeCloseTo(0.6);
  expect(seen[0]).toBeCloseTo(1.85);
});

test('fast frames raise DPR back to max', () => {
  const a = new AdaptiveResolution(1.5);
  let dpr = 1.5;
  for (let i = 0; i < 400; i++) {
    const r = a.update(40, 1 / 25);
    if (r !== null) dpr = r;
  }
  expect(dpr).toBeLessThan(1.5);
  for (let i = 0; i < 8000; i++) {
    const r = a.update(8, 1 / 120);
    if (r !== null) dpr = r;
  }
  expect(dpr).toBeCloseTo(1.5);
});

test('steady frames keep DPR', () => {
  const a = new AdaptiveResolution(1.5);
  for (let i = 0; i < 1000; i++) expect(a.update(18, 1 / 55)).toBeNull();
});

test('budgets match spec', () => {
  expect(BUDGETS.high).toEqual({ drawCalls: 900, triangles: 6_000_000 });
  expect(BUDGETS.medium).toEqual({ drawCalls: 600, triangles: 3_000_000 });
  expect(BUDGETS.low).toEqual({ drawCalls: 300, triangles: 1_200_000 });
});

test('low tier uses 2D cloud layers and no AO', () => {
  expect(TIER_SETTINGS.low.cloudSteps).toBe(0);
  expect(TIER_SETTINGS.low.ao).toBe('off');
  expect(TIER_SETTINGS.high.csmCascades).toBe(4);
});

test('vsync-locked 60 Hz frames count as fast', () => {
  const a = new AdaptiveResolution(1.5);
  let dpr = 1.5;
  for (let i = 0; i < 400; i++) {
    const r = a.update(40, 1 / 25);
    if (r !== null) dpr = r;
  }
  for (let i = 0; i < 60 * 40; i++) {
    const r = a.update(16.7, 1 / 60);
    if (r !== null) dpr = r;
  }
  expect(dpr).toBeCloseTo(1.5);
});

test('does not climb back above a slow DPR for 20 s', () => {
  const a = new AdaptiveResolution(1.5);
  let dpr = 1.5;
  for (let i = 0; i < 30; i++) {
    const r = a.update(40, 1 / 25);
    if (r !== null) dpr = r;
  }
  expect(dpr).toBeCloseTo(1.35);
  let maxSeen = dpr;
  for (let i = 0; i < 60 * 15; i++) {
    const r = a.update(16.7, 1 / 60);
    if (r !== null) {
      dpr = r;
      maxSeen = Math.max(maxSeen, r);
    }
  }
  expect(maxSeen).toBeCloseTo(1.35);
});

describe('readDeviceInfo + detectTier', () => {
  const env = (o: Partial<Parameters<typeof readDeviceInfo>[0]>) =>
    readDeviceInfo({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0, hardwareConcurrency: 12, renderer: 'ANGLE (NVIDIA, RTX 3060)', screenArea: 2e6, ...o });
  test('an Android phone is low', () => expect(detectTier(env({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', maxTouchPoints: 5 }))).toBe('low'));
  test('an iPad reporting as a Mac is low', () => expect(detectTier(env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }))).toBe('low'));
  test('a base Apple M1 Mac is medium', () => expect(detectTier(env({ userAgent: 'Mozilla/5.0 (Macintosh)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', hardwareConcurrency: 8 }))).toBe('medium'));
  test('an Apple M3 Max is high', () => expect(detectTier(env({ userAgent: 'Mozilla/5.0 (Macintosh)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)', hardwareConcurrency: 16 }))).toBe('high'));
  test('a desktop with a discrete GPU is high', () => expect(detectTier(env({}))).toBe('high'));
  test('an Intel laptop is medium', () => expect(detectTier(env({ renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)' }))).toBe('medium'));
});
