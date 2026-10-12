import { generateCloudNoise } from '../src/engine/atmosphere/noise3d';

test('cloud noise is deterministic', () => {
  expect(generateCloudNoise(32, 7)).toEqual(generateCloudNoise(32, 7));
  expect(generateCloudNoise(32, 8)).not.toEqual(generateCloudNoise(32, 7));
});

test('cloud noise tiles across every face', () => {
  // Jumps across the wrap seam must look like ordinary neighbour jumps inside the volume;
  // an untiled volume would show roughly three times larger jumps at the seam.
  const n = 32;
  const a = generateCloudNoise(n, 7);
  const at = (x: number, y: number, z: number) => a[x + n * (y + n * z)];
  let seam = 0;
  let inner = 0;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      seam +=
        Math.abs(at(0, i, j) - at(n - 1, i, j)) +
        Math.abs(at(i, 0, j) - at(i, n - 1, j)) +
        Math.abs(at(i, j, 0) - at(i, j, n - 1));
      inner +=
        Math.abs(at(15, i, j) - at(16, i, j)) +
        Math.abs(at(i, 15, j) - at(i, 16, j)) +
        Math.abs(at(i, j, 15) - at(i, j, 16));
    }
  expect(seam / inner).toBeLessThan(1.3);
});

test('cloud noise uses the full range', () => {
  const a = generateCloudNoise(32, 7);
  let lo = 255,
    hi = 0;
  for (const v of a) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  expect(hi).toBeGreaterThan(200);
  expect(lo).toBeLessThan(50);
});
