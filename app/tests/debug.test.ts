import { parseShotParams } from '../src/engine/debug';

test('parses shot, time and quality', () => {
  expect(parseShotParams('?shot=orbit-night&time=night&quality=low')).toEqual({
    shot: 'orbit-night',
    time: 'night',
    quality: 'low',
  });
});

test('ignores unknown values', () => {
  expect(parseShotParams('?shot=nope&time=noon&quality=ultra')).toEqual({});
});
