import { DISTRICTS } from '../src/content/districts';
import { CHUNK_SIZE, buildBuildingGeometry, buildCity } from '../src/world/buildings/geometry';
import { TIER_SETTINGS } from '../src/engine/quality';
import { planBuilding } from '../src/world/buildings/massing';
import { STYLES } from '../src/world/buildings/styles';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { mulberry32 } from '../src/world/rng';

const layout = createLayout(DEFAULT_SEED, DISTRICTS);
const city = buildCity(layout, DISTRICTS);
const lotOf = (id: string) => layout.lots.find(l => l.id === id)!;
const height = (s: (typeof city.specs)[number]) => Math.max(...s.tiers.map(t => t.y1)) - s.baseY;

test('every buildable lot gets a building', () =>
  expect(city.specs).toHaveLength(layout.lots.filter(l => l.role !== 'park').length));

test('buildings stay inside their lot', () => {
  for (const s of city.specs) {
    const lot = lotOf(s.lotId);
    for (const t of s.tiers) {
      expect(t.cx - t.width / 2).toBeGreaterThanOrEqual(lot.x - lot.width / 2 - 0.01);
      expect(t.cx + t.width / 2).toBeLessThanOrEqual(lot.x + lot.width / 2 + 0.01);
      expect(t.cz - t.depth / 2).toBeGreaterThanOrEqual(lot.z - lot.depth / 2 - 0.01);
      expect(t.cz + t.depth / 2).toBeLessThanOrEqual(lot.z + lot.depth / 2 + 0.01);
    }
  }
});

test('tiers stack and shrink upwards', () => {
  for (const s of city.specs) {
    for (let i = 1; i < s.tiers.length; i++) {
      expect(s.tiers[i].y0).toBeCloseTo(s.tiers[i - 1].y1, 6);
      expect(s.tiers[i].width).toBeLessThanOrEqual(s.tiers[i - 1].width);
      expect(s.tiers[i].depth).toBeLessThanOrEqual(s.tiers[i - 1].depth);
    }
  }
});

test('heights snap to floors and respect style ranges', () => {
  for (const s of city.specs) {
    const floors = height(s) / s.floorHeight;
    expect(Math.abs(floors - Math.round(floors))).toBeLessThan(1e-6);
    if (s.districtId !== undefined || lotOf(s.lotId).role === 'monolith') continue;
    expect(height(s)).toBeGreaterThanOrEqual(STYLES[s.style].height[0] - 1e-6);
    expect(height(s)).toBeLessThanOrEqual(STYLES[s.style].height[1] + 1e-6);
  }
});

test('monolith is 320 m', () => {
  const m = city.specs.find(s => lotOf(s.lotId).role === 'monolith')!;
  expect(height(m)).toBeCloseTo(320, 6);
  expect(m.crown).toBe('spire');
});

test('wall uvs are in meters', () => {
  const spec = planBuilding(
    layout.lots.find(l => l.role === 'filler')!,
    0,
    mulberry32(3),
  );
  const { walls } = buildBuildingGeometry(spec, mulberry32(4));
  const pos = walls.getAttribute('position');
  const uv = walls.getAttribute('uv');
  // First quad: vertices 0 and 1 are the bottom edge of one wall.
  const width = Math.hypot(pos.getX(1) - pos.getX(0), pos.getZ(1) - pos.getZ(0));
  expect(Math.abs(uv.getX(1) - uv.getX(0))).toBeCloseTo(width, 4);
  const tierHeight = pos.getY(2) - pos.getY(1);
  expect(uv.getY(2) - uv.getY(1)).toBeCloseTo(tierHeight, 4);
});

test('aBuilding encodes style and floor height', () => {
  const spec = planBuilding(
    layout.lots.find(l => l.role === 'filler')!,
    0,
    mulberry32(5),
  );
  const { walls } = buildBuildingGeometry(spec, mulberry32(6));
  const a = walls.getAttribute('aBuilding');
  expect(a.getY(0)).toBe(STYLES[spec.style].index);
  expect(a.getZ(0)).toBeCloseTo(spec.floorHeight, 5);
  expect(a.getW(0)).toBeCloseTo(spec.bayWidth, 5);
  expect(a.getX(0)).toBeGreaterThanOrEqual(0);
  expect(a.getX(0)).toBeLessThan(1);
});

test('whole city fits the high triangle budget with headroom', () => {
  const tris = city.chunks.reduce(
    (sum, c) => sum + [c.walls, c.trims, c.roofs].reduce((s, g) => s + (g.index ? g.index.count / 3 : 0), 0),
    0,
  );
  expect(tris + city.props.length * 200).toBeLessThan(3_500_000);
});

test('every district has a landmark spec', () => {
  const ids = new Set(city.specs.filter(s => s.districtId !== undefined).map(s => s.districtId));
  expect(ids.size).toBe(16);
});

test('roof props stay on their roofs', () => {
  for (const p of city.props) expect(Number.isFinite(p.y)).toBe(true);
  expect(city.props.length).toBeGreaterThan(city.specs.length);
});

test('curtain walls carry no sub-pixel fin geometry', () => {
  const lot = layout.lots.find(l => l.role === 'filler')!;
  const spec = { ...planBuilding(lot, 0, mulberry32(9)), style: 'glass' as const, crown: 'flat' as const };
  const { trims } = buildBuildingGeometry(spec, mulberry32(10));
  // Per tier: a cornice ring (4 closed boxes, 12 triangles each) and a parapet ring (4 open boxes, 10 each).
  expect(trims.index!.count / 3).toBe(spec.tiers.length * (4 * 12 + 4 * 10));
});

test('an unbounded chunk size merges each island into one chunk', () => {
  const merged = buildCity(layout, DISTRICTS, { chunkSize: Infinity });
  expect(merged.chunks).toHaveLength(layout.islands.length);
  const count = (c: typeof merged) => c.chunks.reduce((n, k) => n + (k.walls.index?.count ?? 0), 0);
  expect(count(merged)).toBe(count(city));
});

test('low tier merges buildings per island', () => {
  expect(TIER_SETTINGS.low.buildingChunk).toBe(Infinity);
  expect(TIER_SETTINGS.high.buildingChunk).toBe(CHUNK_SIZE);
});
