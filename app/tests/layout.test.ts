import { DISTRICTS } from '../src/content/districts';
import { DEFAULT_SEED, createLayout, findOverlaps, groundY, lotCorners } from '../src/world/layout';
import { mulberry32 } from '../src/world/rng';

const L = createLayout(DEFAULT_SEED, DISTRICTS);

test('rng matches the v1 mulberry32 sequence', () => {
  const r = mulberry32(1);
  expect(r()).toBeCloseTo(0.6270739405881613, 12);
});

test('deterministic', () => expect(JSON.stringify(createLayout(DEFAULT_SEED, DISTRICTS))).toBe(JSON.stringify(L)));

test('another seed gives another city', () =>
  expect(JSON.stringify(createLayout(7, DISTRICTS))).not.toBe(JSON.stringify(L)));

test('main island is listed first and is 520 m across', () => {
  expect(L.islands[0].id).toBe('main');
  expect(L.islands[0].radius).toBe(260);
  expect(L.islands[0].depth).toBe(234);
});

test('satellites sit 420 m out', () => {
  const sats = L.islands.filter(i => i.id !== 'main');
  expect(sats).toHaveLength(4);
  for (const i of sats) expect(Math.hypot(i.cx, i.cz)).toBeCloseTo(420, 0);
});

test('lots do not overlap', () => expect(findOverlaps(L.lots)).toEqual([]));

test('lots stay on their island with 18 m margin', () => {
  for (const lot of L.lots) {
    const is = L.islands.find(i => i.id === lot.islandId)!;
    for (const [x, z] of lotCorners(lot))
      expect(Math.hypot(x - is.cx, z - is.cz)).toBeLessThanOrEqual(is.radius - 18 + 1e-6);
  }
});

test('every district has exactly one landmark lot', () => {
  const ids = L.lots
    .filter(l => l.role === 'landmark')
    .map(l => l.districtId)
    .sort((a, b) => a! - b!);
  expect(ids).toEqual(DISTRICTS.map(d => d.id).sort((a, b) => a - b));
});

test('landmark lots sit on the 70–210 m ring and are at least 24 m wide', () => {
  for (const lot of L.lots.filter(l => l.role === 'landmark')) {
    const r = Math.hypot(lot.x, lot.z);
    expect(r).toBeGreaterThanOrEqual(70);
    expect(r).toBeLessThanOrEqual(210);
    expect(Math.min(lot.width, lot.depth)).toBeGreaterThanOrEqual(24);
  }
});

test('one monolith at the center', () => {
  const m = L.lots.filter(l => l.role === 'monolith');
  expect(m).toHaveLength(1);
  expect(Math.hypot(m[0].x, m[0].z)).toBeLessThan(60);
});

test('street widths within spec', () => {
  for (const s of L.streets) {
    expect(s.width).toBeGreaterThanOrEqual(14);
    expect(s.width).toBeLessThanOrEqual(22);
  }
  expect(L.streets.some(s => s.kind === 'avenue' && s.width === 22)).toBe(true);
});

test('lots are at least 18 m on each side', () => {
  for (const lot of L.lots) expect(Math.min(lot.width, lot.depth)).toBeGreaterThanOrEqual(18);
});

test('every satellite is built up', () => {
  for (const id of ['ne', 'nw', 'se', 'sw'])
    expect(L.lots.filter(l => l.islandId === id).length).toBeGreaterThanOrEqual(4);
});

test('four bridges span the gaps', () => {
  expect(L.bridges).toHaveLength(4);
  for (const b of L.bridges) expect(Math.hypot(b.bx - b.ax, b.bz - b.az)).toBeGreaterThan(20);
});

test('groundY reports island tops and NaN in the sky', () => {
  expect(groundY(L, 0, 0)).toBe(0);
  expect(groundY(L, 0, 380)).toBeNaN();
});
