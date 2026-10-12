import { DISTRICTS } from '../src/content/districts';
import { rasterizeGround, worldToMask } from '../src/world/ground/groundMask';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { planFurniture } from '../src/world/street/furniture';

const L = createLayout(DEFAULT_SEED, DISTRICTS);
const main = L.islands[0];
const SIZE = 1024;
const mask = rasterizeGround(L, 'main', SIZE);
const onMain = (p: { x: number; z: number }) => Math.hypot(p.x - main.cx, p.z - main.cz) < main.radius;
const asphalt = (p: { x: number; z: number }) => {
  const [px, pz] = worldToMask(p.x, p.z, main, SIZE);
  return mask[(pz * SIZE + px) * 4];
};
const high = planFurniture(L, 'high');

test('trees stand on sidewalks or lawns, never on the road', () => {
  const trees = high.trees.filter(onMain);
  expect(trees.length).toBeGreaterThan(300);
  for (const t of trees) expect(asphalt(t)).toBe(0);
});

test('parked cars sit on the road next to the kerb', () => {
  const cars = high.parkedCars.filter(onMain);
  expect(cars.length).toBeGreaterThan(80);
  for (const c of cars) {
    expect(asphalt(c)).toBe(255);
    const s = L.streets.find(
      s =>
        s.islandId === 'main' &&
        (Math.abs(s.ax - s.bx) < 1e-6 ? Math.abs(c.x - s.ax) <= s.width / 2 : Math.abs(c.z - s.az) <= s.width / 2),
    )!;
    const fromAxis = Math.abs(s.ax === s.bx ? c.x - s.ax : c.z - s.az);
    const fromKerb = s.width / 2 - fromAxis;
    expect(fromKerb).toBeGreaterThanOrEqual(1.0);
    expect(fromKerb).toBeLessThanOrEqual(2.4);
  }
});

test('no tree, car or bench stands on a building lot', () => {
  const lots = L.lots.filter(l => l.role !== 'park');
  for (const p of [...high.trees, ...high.parkedCars, ...high.benches])
    for (const lot of lots)
      expect(Math.abs(p.x - lot.x) < lot.width / 2 && Math.abs(p.z - lot.z) < lot.depth / 2).toBe(false);
});

test('railings ring each island with gaps for bridges', () => {
  for (const island of L.islands) {
    const segs = high.railings.filter(
      r => Math.hypot((r.ax + r.bx) / 2 - island.cx, (r.az + r.bz) / 2 - island.cz) < island.radius + 2,
    );
    const length = segs.reduce((s, r) => s + Math.hypot(r.bx - r.ax, r.bz - r.az), 0);
    const gaps = L.bridges.filter(b => b.from === island.id || b.to === island.id).reduce((s, b) => s + b.width + 2, 0);
    const expected = 2 * Math.PI * (island.radius - 1) - gaps;
    expect(Math.abs(length - expected) / expected).toBeLessThan(0.02);
  }
});

test('low tier plants about half the trees', () => {
  const low = planFurniture(L, 'low').trees.length;
  expect(low / high.trees.length).toBeGreaterThan(0.45);
  expect(low / high.trees.length).toBeLessThan(0.55);
});

test('lamps face their street', () => {
  for (const lamp of high.lamps.slice(0, 50)) {
    const dx = Math.cos(lamp.rotY);
    const dz = -Math.sin(lamp.rotY);
    // One metre along the arm is still off-road; four metres along it is roadway.
    expect(asphalt({ x: lamp.x + dx * 4, z: lamp.z + dz * 4 }) === 255 || !onMain(lamp)).toBe(true);
  }
});

test('low tier parks about half as many cars', () => {
  const high = planFurniture(L, 'high').parkedCars.length;
  const low = planFurniture(L, 'low').parkedCars.length;
  expect(low).toBeGreaterThan(high * 0.4);
  expect(low).toBeLessThan(high * 0.6);
});
