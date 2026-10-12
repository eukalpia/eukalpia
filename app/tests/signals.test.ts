import { discover, loadSignals, saveSignals, SIGNALS_KEY } from '../src/app/signals';

const memory = (value: string | null, fail = false) => {
  const data = new Map<string, string>();
  if (value !== null) data.set(SIGNALS_KEY, value);
  return {
    data,
    getItem: (k: string) => {
      if (fail) throw new Error('denied');
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (fail) throw new Error('denied');
      data.set(k, v);
    },
  };
};

test('the list is read in discovery order, keeping only known ids, once each', () => {
  expect(SIGNALS_KEY).toBe('eukalpia:signals');
  expect(loadSignals(memory('["cipher","cat","cipher","dragon","ghost"]'))).toEqual(['cipher', 'cat', 'ghost']);
});

test('damaged or foreign storage reads as nothing found, without throwing', () => {
  for (const raw of ['not json', '{"cat":true}', '42', 'null', '[1,2]'])
    expect(loadSignals(memory(raw)), raw).toEqual([]);
  expect(loadSignals(memory(null))).toEqual([]);
  expect(loadSignals(memory('["cat"]', true))).toEqual([]);
  expect(loadSignals(null)).toEqual([]);
});

test('writing swallows storage errors', () => {
  const s = memory(null);
  saveSignals(s, ['cat', 'ghost']);
  expect(s.data.get(SIGNALS_KEY)).toBe('["cat","ghost"]');
  expect(() => saveSignals(memory(null, true), ['cat'])).not.toThrow();
});

test('a first discovery is added and toasted; a repeat changes nothing and says nothing', () => {
  const first = discover([], 'cat');
  expect(first).toEqual({ list: ['cat'], isNew: true, toast: 'ROOFTOP RESIDENT · The city has adopted you.' });
  const again = discover(['cat'], 'cat');
  expect(again).toEqual({ list: ['cat'], isNew: false, toast: null });
});

test('the sixth discovery announces that all are found instead of its own message', () => {
  const r = discover(['cat', 'monolith', 'override', 'underworld', 'cipher'], 'ghost');
  expect(r.list).toHaveLength(6);
  expect(r.toast).toBe('ALL SIGNALS FOUND · THE CITY REMEMBERS YOU.');
});
