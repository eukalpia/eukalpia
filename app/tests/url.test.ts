import { parseSector, shareUrl, withSector } from '../src/app/url';

test('sector parameter follows v1', () => {
  expect(parseSector('?sector=street')).toBe('street');
  expect(parseSector('?sector=-1')).toBe('underworld');
  expect(parseSector('?sector=underworld')).toBe('underworld');
  expect(parseSector('')).toBe('overview');
  expect(parseSector('?sector=moon')).toBe('overview');
});

test('navigation writes ?sector= (overview, street or -1) and keeps other parameters', () => {
  expect(withSector('https://x.io/eukalpia/?quality=low', 'street')).toBe(
    'https://x.io/eukalpia/?quality=low&sector=street',
  );
  expect(withSector('https://x.io/eukalpia/?sector=street#a', 'underworld')).toBe('https://x.io/eukalpia/?sector=-1#a');
  expect(withSector('https://x.io/eukalpia/', 'overview')).toBe('https://x.io/eukalpia/?sector=overview');
});

test('the share link carries only the sector, and keeps the hash', () => {
  expect(shareUrl('https://eukalpia.github.io/eukalpia/?quality=low&shot=x#top', 'underworld')).toBe(
    'https://eukalpia.github.io/eukalpia/?sector=-1#top',
  );
  expect(shareUrl('https://eukalpia.github.io/eukalpia/', 'overview')).toBe(
    'https://eukalpia.github.io/eukalpia/?sector=overview',
  );
});
