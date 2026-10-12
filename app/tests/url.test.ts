import { parseSector } from '../src/app/url';

test('sector parameter follows v1', () => {
  expect(parseSector('?sector=street')).toBe('street');
  expect(parseSector('?sector=-1')).toBe('underworld');
  expect(parseSector('?sector=underworld')).toBe('underworld');
  expect(parseSector('')).toBe('overview');
  expect(parseSector('?sector=moon')).toBe('overview');
});
