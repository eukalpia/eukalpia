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

test('parses known debug flags and drops unknown ones', () => {
  expect(parseShotParams('?debug=nofog,noreflect,bogus').debug).toEqual(['nofog', 'noreflect']);
});

test('street shots are recognised', () => {
  expect(parseShotParams('?shot=street-night').shot).toBe('street-night');
  expect(parseShotParams('?shot=street-day').shot).toBe('street-day');
  expect(parseShotParams('?shot=street-corner').shot).toBe('street-corner');
});

test('character shots are recognised', () => {
  expect(parseShotParams('?shot=character-front').shot).toBe('character-front');
  expect(parseShotParams('?shot=character-side').shot).toBe('character-side');
});

test('walkcycle is a debug flag', () => {
  expect(parseShotParams('?debug=walkcycle').debug).toEqual(['walkcycle']);
});
