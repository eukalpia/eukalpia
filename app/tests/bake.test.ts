import { BufferAttribute, BufferGeometry, type DataTexture } from 'three';
import { DISTRICTS } from '../src/content/districts';
import { rasterizeGround } from '../src/world/ground/groundMask';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { FACADE_CELLS, bakeFacade, bakeGround, facadeOffsets, facadeUV, rockUVs } from '../src/phototrace/bake';

const pixel = (tex: DataTexture, fx: number, fy: number) => {
  const w = tex.image.width;
  const x = Math.min(w - 1, Math.floor(fx * w));
  const y = Math.min(w - 1, Math.floor(fy * w));
  const i = (y * w + x) * 4;
  const d = tex.image.data!;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
};

test('a wall vertex lands in the right atlas cell', () => {
  const seed = 0.3141;
  const [offB, offF] = facadeOffsets(seed);
  const [u, v] = facadeUV(9, 8, [seed, 1, 4, 3], false);
  expect(u).toBeCloseTo((3 + offB) / FACADE_CELLS, 6);
  expect(v).toBeCloseTo((2 + offF) / FACADE_CELLS, 6);
  // The ground floor maps onto the one-row storefront strip.
  const [, vg] = facadeUV(9, 2, [seed, 1, 4, 3], true);
  expect(vg).toBeCloseTo(0.5, 6);
});

test('the atlas repeats every 16 bays and floors', () => {
  const b: [number, number, number, number] = [0.77, 0, 4, 3];
  const [u0, v0] = facadeUV(0, 0, b, false);
  const [u1, v1] = facadeUV(16 * 3, 16 * 4, b, false);
  expect(u1 - u0).toBeCloseTo(1, 6);
  expect(v1 - v0).toBeCloseTo(1, 6);
});

test('at night the share of lit windows follows the ratio', () => {
  let lit = 0;
  let cells = 0;
  for (let seed = 1; seed <= 8; seed++) {
    const maps = bakeFacade('glass', { night: true, litRatio: 0.28, seed, size: 256 }).upper;
    const e = maps.emissiveMap!;
    for (let cy = 0; cy < FACADE_CELLS; cy++)
      for (let cx = 0; cx < FACADE_CELLS; cx++) {
        const [r] = pixel(e, (cx + 0.5) / FACADE_CELLS, (cy + 0.5) / FACADE_CELLS);
        cells++;
        if (r > 20) lit++;
      }
  }
  expect(lit / cells).toBeGreaterThan(0.24);
  expect(lit / cells).toBeLessThan(0.32);
});

test('by day nothing glows', () => {
  const maps = bakeFacade('artdeco', { night: false, litRatio: 0.04, seed: 3, size: 128 });
  expect(maps.upper.emissiveMap).toBeNull();
  expect(maps.ground.emissiveMap).toBeNull();
});

test('panes are smooth, piers are rough', () => {
  const glass = bakeFacade('glass', { night: false, litRatio: 0, seed: 5, size: 256 }).upper;
  const centre = 0.5 / FACADE_CELLS;
  expect(pixel(glass.roughnessMap, centre, centre)[1] / 255).toBeLessThan(0.15);
  const deco = bakeFacade('artdeco', { night: false, litRatio: 0, seed: 5, size: 256 }).upper;
  expect(pixel(deco.roughnessMap, 0.1 / FACADE_CELLS, centre)[1] / 255).toBeGreaterThan(0.6);
});

test('baked ground follows the mask', () => {
  const L = createLayout(DEFAULT_SEED, DISTRICTS);
  const size = 512;
  const mask = rasterizeGround(L, 'main', size);
  const ground = bakeGround(L, 'main', size);
  const find = (want: (i: number) => boolean) => {
    for (let i = 0; i < size * size; i++) if (want(i * 4)) return i;
    throw new Error('no such pixel');
  };
  const asphalt = find(i => mask[i] === 255 && mask[i + 3] === 0);
  const paving = find(i => mask[i + 1] === 255 && mask[i] === 0);
  const grass = find(i => mask[i + 2] === 255);
  const at = (i: number) => Array.from((ground.map.image.data as Uint8Array).slice(i * 4, i * 4 + 3));
  const lum = (c: number[]) => c[0] + c[1] + c[2];
  expect(lum(at(asphalt))).toBeLessThan(lum(at(paving)));
  const g = at(grass);
  expect(g[1]).toBeGreaterThan(g[0]);
  expect(g[1]).toBeGreaterThan(g[2]);
});

test('rock gets box-projected uvs from its dominant normal axis', () => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([4, -10, 6, 8, -12, 2, 0, -2, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, -1, 0, 0, -0.9, 0.1, 1, 0, 0]), 3));
  const uv = rockUVs(g, 0.1);
  expect([uv[0], uv[1]]).toEqual([0.4, 0.6].map(x => expect.closeTo(x, 6)));
  expect([uv[4], uv[5]]).toEqual([0, -0.2].map(x => expect.closeTo(x, 6)));
});
