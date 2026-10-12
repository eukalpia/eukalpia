import { DISTRICTS } from '../src/content/districts';
import { lampPositions, rasterizeGround, worldToMask } from '../src/world/ground/groundMask';
import { DEFAULT_SEED, createLayout, groundY } from '../src/world/layout';

const L = createLayout(DEFAULT_SEED, DISTRICTS);
const main = L.islands[0];
const SIZE = 512;
const mask = rasterizeGround(L, 'main', SIZE);
const at = (x: number, z: number, c: number) => {
  const [px, pz] = worldToMask(x, z, main, SIZE);
  return mask[(pz * SIZE + px) * 4 + c];
};

test('ground mask marks streets as asphalt', () => {
  for (const s of L.streets.filter(s => s.islandId === 'main')) {
    // A quarter of the way along, off the centre line markings.
    const x = s.ax + (s.bx - s.ax) * 0.25;
    const z = s.az + (s.bz - s.az) * 0.25;
    expect(at(x, z, 0)).toBe(255);
  }
});

test('lots are not asphalt', () => {
  for (const lot of L.lots.filter(l => l.islandId === 'main')) expect(at(lot.x, lot.z, 0)).toBe(0);
});

test('parks are grass', () => {
  const park = L.lots.find(l => l.islandId === 'main' && l.role === 'park');
  if (park) expect(at(park.x, park.z, 2)).toBe(255);
});

test('outside the island is empty', () => {
  expect(at(main.radius - 0.5, main.radius - 0.5, 0)).toBe(0);
  expect(at(main.radius - 0.5, main.radius - 0.5, 1)).toBe(0);
});

test('lamps line the streets every 25 m', () => {
  const p = lampPositions(L);
  expect(p.length % 3).toBe(0);
  expect(p.length / 3).toBeGreaterThan(200);
  for (let i = 1; i < p.length; i += 3) expect(p[i] - groundY(L, p[i - 1], p[i + 1])).toBeCloseTo(7, 1);
});

test('lamps never stand inside a roadway', () => {
  const p = lampPositions(L);
  for (let i = 0; i < p.length; i += 3) expect(at(p[i], p[i + 2], 0)).toBe(0);
});
