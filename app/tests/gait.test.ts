import { footLift, gaitPhase, solveTwoBone } from '../src/character/gait';

function footOf(upper: number, lower: number, target: number) {
  const { hip, knee } = solveTwoBone(upper, lower, target);
  const kx = upper * Math.cos(hip);
  const ky = upper * Math.sin(hip);
  return [kx + lower * Math.cos(hip - knee), ky + lower * Math.sin(hip - knee)];
}

test('two-bone IK reaches a target inside the leg length', () => {
  for (const target of [0.5, 0.65, 0.78, 0.8]) {
    const [x, y] = footOf(0.42, 0.39, target);
    expect(Math.hypot(x - target, y)).toBeLessThan(1e-4);
  }
});

test('an out-of-reach target straightens the leg', () => {
  expect(solveTwoBone(0.42, 0.39, 2).knee).toBeCloseTo(0, 6);
  expect(solveTwoBone(0.42, 0.39, 2).hip).toBeCloseTo(0, 6);
});

test('the knee always bends the same way', () => {
  for (const target of [0.3, 0.6, 0.79]) expect(solveTwoBone(0.42, 0.39, target).knee).toBeGreaterThanOrEqual(0);
});

test('gait phase advances one cycle per stride', () => {
  expect(gaitPhase(0, 1.4)).toBe(0);
  expect(gaitPhase(0.7, 1.4)).toBeCloseTo(0.5);
  expect(gaitPhase(1.4 * 3 + 0.35, 1.4)).toBeCloseTo(0.25);
});

test('feet only lift during swing, and higher when running', () => {
  for (let p = 0; p < 0.6; p += 0.05) expect(footLift(p, 1.6)).toBe(0);
  expect(footLift(0.8, 4.2)).toBeGreaterThan(footLift(0.8, 1.6));
  expect(footLift(0.8, 1.6)).toBeGreaterThan(0.05);
});
