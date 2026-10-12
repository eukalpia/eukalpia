import { DISTRICTS } from '../src/content/districts';
import { SIGNALS } from '../src/content/signals';

test('16 districts with unique ids', () => {
  expect(DISTRICTS).toHaveLength(16);
  expect(new Set(DISTRICTS.map(d => d.id)).size).toBe(16);
});

test('admissions keeps its impact line', () =>
  expect(DISTRICTS.find(d => d.name === 'qabul.turin.uz')?.impact).toBe('11,000 users'));

test('EDU AI lists five capabilities', () =>
  expect(DISTRICTS.find(d => d.name === 'EDU AI / CAU')?.capabilities).toHaveLength(5));

test('public repositories are linked on GitHub', () => {
  for (const name of ['cinder', 'eukalpia', 'Pixen', 'PodBus', 'tensora', 'veyra'])
    expect(DISTRICTS.find(d => d.name === name)?.url).toBe(`https://github.com/eukalpia/${name}`);
});

test('colors follow the v1 palette by id order', () => {
  const sorted = [...DISTRICTS].sort((a, b) => a.id - b.id);
  expect(sorted[0].color).toBe('#ff9b69');
  expect(sorted[6].color).toBe('#ff9b69');
});

test('six signals with hints', () => {
  expect(Object.keys(SIGNALS)).toEqual(['cat', 'monolith', 'override', 'underworld', 'cipher', 'ghost']);
  expect(SIGNALS.monolith.message).toBe('SEVEN KNOCKS · You found the heartbeat.');
  for (const s of Object.values(SIGNALS)) expect(s.hint.length).toBeGreaterThan(10);
});
