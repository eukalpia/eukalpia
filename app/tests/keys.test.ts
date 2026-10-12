import { createKeys, KONAMI, type KeyContext } from '../src/app/keys';

const ctx = (over: Partial<KeyContext> = {}): KeyContext => ({
  panelOpen: false,
  walking: false,
  flyOnCanvas: false,
  tracing: false,
  sector: 'overview',
  ...over,
});
const ev = (key: string, target: { tagName: string } = { tagName: 'BODY' }) => ({
  key,
  target,
  repeat: false,
  preventDefault: vi.fn(),
});

function setup(c: KeyContext = ctx()) {
  const calls: string[] = [];
  const keys = createKeys({
    context: () => c,
    projects: () => calls.push('projects'),
    go: s => calls.push(`go:${s}`),
    pause: () => calls.push('pause'),
    override: () => calls.push('override'),
  });
  return { keys, calls };
}

test('the Konami code triggers override, even with a panel open, but not while typing', () => {
  const { keys, calls } = setup(ctx({ panelOpen: true }));
  for (const k of KONAMI) keys.down(ev(k));
  expect(calls).toEqual(['override']);
  const typing = setup();
  for (const k of KONAMI) typing.keys.down(ev(k, { tagName: 'INPUT' }));
  expect(typing.calls).toEqual([]);
});

test('a wrong key resets the code, and B / A are case-sensitive as in v1', () => {
  const { keys, calls } = setup();
  for (const k of [...KONAMI.slice(0, 5), 'x', ...KONAMI]) keys.down(ev(k));
  expect(calls).toEqual(['override']);
  const shifted = setup();
  for (const k of [...KONAMI.slice(0, 8), 'B', 'A']) shifted.keys.down(ev(k));
  expect(shifted.calls).toEqual([]);
});

test('a wrong ArrowUp counts as the first step of a new attempt', () => {
  const { keys, calls } = setup();
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowUp', ...KONAMI.slice(1)]) keys.down(ev(k));
  expect(calls).toEqual(['override']);
});

test('D opens Projects, E switches overview and street, Space pauses', () => {
  const { keys, calls } = setup();
  keys.down(ev('d'));
  keys.down(ev('E'));
  const space = ev(' ');
  keys.down(space);
  expect(calls).toEqual(['projects', 'go:street', 'pause']);
  expect(space.preventDefault).toHaveBeenCalled();
});

test('E from street goes to the overview; from floor −1 it goes to street level, like Help (v1 split them)', () => {
  const street = setup(ctx({ sector: 'street' }));
  street.keys.down(ev('e'));
  const below = setup(ctx({ sector: 'underworld' }));
  below.keys.down(ev('e'));
  expect([...street.calls, ...below.calls]).toEqual(['go:overview', 'go:street']);
});

test('D, E and Space are silent with a panel open, while walking, in free flight on the canvas', () => {
  for (const c of [ctx({ panelOpen: true }), ctx({ walking: true }), ctx({ flyOnCanvas: true })]) {
    const { keys, calls } = setup(c);
    for (const k of ['d', 'e', ' ']) keys.down(ev(k));
    expect(calls).toEqual([]);
  }
});

test('Space does not pause in photo mode or on a focused button', () => {
  const tracing = setup(ctx({ tracing: true }));
  tracing.keys.down(ev(' '));
  const onButton = setup();
  onButton.keys.down(ev(' ', { tagName: 'BUTTON' }));
  expect([...tracing.calls, ...onButton.calls]).toEqual([]);
});
