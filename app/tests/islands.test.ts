import { DISTRICTS } from '../src/content/districts';
import { buildBridge } from '../src/world/islands/bridge';
import { buildIslandRock, buildRoots } from '../src/world/islands/island';
import { buildWaterfalls } from '../src/world/islands/waterfall';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { mulberry32 } from '../src/world/rng';

const L = createLayout(DEFAULT_SEED, DISTRICTS);
const main = L.islands[0];
const sat = L.islands[2];

function yRange(g: import('three').BufferGeometry) {
  const p = g.getAttribute('position');
  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < p.count; i++) {
    lo = Math.min(lo, p.getY(i));
    hi = Math.max(hi, p.getY(i));
  }
  return [lo, hi];
}

test('island top rim is flat at topY', () => {
  for (const island of [main, sat]) {
    const g = buildIslandRock(island, mulberry32(1));
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeLessThanOrEqual(island.topY + 0.01);
    let rim = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > island.topY - 0.06) rim++;
    expect(rim).toBeGreaterThan(64);
  }
});

test('island underside reaches its depth', () => {
  for (const island of [main, sat]) {
    const [lo] = yRange(buildIslandRock(island, mulberry32(2)));
    expect(lo).toBeLessThan(island.topY - island.depth * 0.85);
    expect(lo).toBeGreaterThan(island.topY - island.depth * 1.15);
  }
});

test('rock stays within the triangle budget', () => {
  const g = buildIslandRock(main, mulberry32(3));
  expect(g.index!.count / 3).toBeLessThan(80_000);
});

test('roots hang below the island top', () => {
  const g = buildRoots(main, mulberry32(4));
  const [lo, hi] = yRange(g);
  expect(hi).toBeLessThan(main.topY - 10);
  expect(lo).toBeGreaterThan(main.topY - main.depth * 1.3);
});

test('waterfalls fall from the rim into the cloud sea', () => {
  const { geometry, count } = buildWaterfalls(main, mulberry32(5), L.bridges);
  expect(count).toBeGreaterThanOrEqual(2);
  expect(count).toBeLessThanOrEqual(4);
  const [lo, hi] = yRange(geometry);
  expect(lo).toBeCloseTo(-360, 0);
  expect(hi).toBeLessThanOrEqual(main.topY + 0.5);
});

test('bridges span from island to island', () => {
  const b = L.bridges[0];
  const g = buildBridge(b);
  g.computeBoundingBox();
  const box = g.boundingBox!;
  expect(Math.min(b.ax, b.bx)).toBeGreaterThanOrEqual(box.min.x - 0.01);
  expect(Math.max(b.ax, b.bx)).toBeLessThanOrEqual(box.max.x + 0.01);
  expect(box.max.y).toBeGreaterThan(Math.max(b.ay, b.by) + 8);
});

test('rock faces point outwards so the underside is visible from below', () => {
  const g = buildIslandRock(main, mulberry32(6));
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  let outward = 0;
  let total = 0;
  for (let i = 0; i < p.count; i += 7) {
    if (p.getY(i) > main.topY - 5) continue;
    const rx = p.getX(i) - main.cx;
    const rz = p.getZ(i) - main.cz;
    const radial = (n.getX(i) * rx + n.getZ(i) * rz) / (Math.hypot(rx, rz) || 1);
    if (radial - n.getY(i) * 0.3 > 0) outward++;
    total++;
  }
  expect(outward / total).toBeGreaterThan(0.9);
});
