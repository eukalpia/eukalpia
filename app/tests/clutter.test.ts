import { DISTRICTS } from '../src/content/districts';
import { buildCity } from '../src/world/buildings/geometry';
import { rasterizeGround, worldToMask } from '../src/world/ground/groundMask';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { planClutter, signalState } from '../src/world/street/clutter';

const L = createLayout(DEFAULT_SEED, DISTRICTS);
const specs = buildCity(L, DISTRICTS).specs;
const plan = planClutter(L, specs);
const main = L.islands[0];
const SIZE = 1024;
const mask = rasterizeGround(L, 'main', SIZE);
const onMain = (p: { x: number; z: number }) => Math.hypot(p.x - main.cx, p.z - main.cz) < main.radius - 2;
const road = (p: { x: number; z: number }) => {
  const [px, pz] = worldToMask(p.x, p.z, main, SIZE);
  return mask[(pz * SIZE + px) * 4];
};

test('every crossing gets signal poles on its sidewalk corners', () => {
  expect(plan.crossings.length).toBeGreaterThan(10);
  expect(plan.signals.length).toBe(plan.crossings.length * 4);
  for (const s of plan.signals.filter(onMain)) expect(road(s)).toBe(0);
});

test('a crossing never shows green both ways', () => {
  for (const c of plan.crossings.slice(0, 10))
    for (let t = 0; t < 90; t += 0.25) {
      const s = signalState(c, t);
      expect(s.ns === 'green' && s.ew === 'green').toBe(false);
    }
});

test('each direction cycles through green, amber and red', () => {
  const seen = new Set<string>();
  for (let t = 0; t < 60; t += 0.5) seen.add(signalState(plan.crossings[0], t).ns);
  expect([...seen].sort()).toEqual(['amber', 'green', 'red']);
});

test('awnings hang over street-facing storefronts, outside the walls and off the road', () => {
  expect(plan.awnings.length).toBeGreaterThan(40);
  for (const a of plan.awnings.filter(onMain)) {
    expect(road(a)).toBe(0);
    const spec = specs.find(s => s.lotId === a.lotId)!;
    const t = spec.tiers[0];
    const outside = Math.abs(a.x - t.cx) > t.width / 2 - 0.01 || Math.abs(a.z - t.cz) > t.depth / 2 - 0.01;
    expect(outside).toBe(true);
    expect(a.y).toBeCloseTo(spec.baseY + spec.floorHeight - 0.55, 2);
  }
});

test('signs use the word atlas', () => {
  expect(plan.signs.length).toBeGreaterThan(40);
  for (const s of plan.signs) expect(s.word).toBeGreaterThanOrEqual(0);
});
