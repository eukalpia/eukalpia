import { cascadeFar } from '../src/engine/lighting/sun';

test('from the default orbit the cascades reach past the far satellite', () => {
  // Tour distance 1150–1230 m; the far rim of a satellite sits ~1700 m away.
  expect(cascadeFar(1230)).toBeGreaterThanOrEqual(1750);
});

test('at street level the cascades stay tight for crisp shadows', () => {
  const far = cascadeFar(150);
  expect(far).toBeGreaterThanOrEqual(400);
  expect(far).toBeLessThanOrEqual(900);
});

test('at the maximum orbit distance shadows still exist', () => {
  expect(cascadeFar(2200)).toBeGreaterThanOrEqual(2700);
});
