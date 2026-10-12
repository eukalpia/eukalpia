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
  expect(parseShotParams('?shot=lms-lift').shot).toBe('lms-lift');
  expect(parseShotParams('?shot=lms-roof').shot).toBe('lms-roof');
  expect(parseShotParams('?shot=character-closeup').shot).toBe('character-closeup');
  expect(parseShotParams('?shot=character-three-quarter').shot).toBe('character-three-quarter');
});

test('character shots are recognised', () => {
  expect(parseShotParams('?shot=character-front').shot).toBe('character-front');
  expect(parseShotParams('?shot=character-side').shot).toBe('character-side');
});

test('walkcycle is a debug flag', () => {
  expect(parseShotParams('?debug=walkcycle').debug).toEqual(['walkcycle']);
  expect(parseShotParams('?debug=tm-aces,tm-neutral').debug).toEqual(['tm-aces', 'tm-neutral']);
});
