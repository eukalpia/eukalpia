import { Box3, Color, Matrix4, Vector3 } from 'three';
import {
  CAR_KINDS,
  CAR_LAMP,
  CAR_PART,
  carGeometry,
  carKindFor,
  createCarFleet,
  LOD_NEAR,
  TAXI_YELLOW,
  WHEELS,
} from '../src/world/street/cars';

const boxOf = (kind: (typeof CAR_KINDS)[number], lod: 'near' | 'far') => {
  const g = carGeometry(kind, lod);
  g.computeBoundingBox();
  return { g, box: g.boundingBox as Box3 };
};
const tris = (g: ReturnType<typeof carGeometry>) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const partPoints = (g: ReturnType<typeof carGeometry>, part: number) => {
  const pos = g.getAttribute('position');
  const parts = g.getAttribute('aPart');
  const out: Vector3[] = [];
  for (let i = 0; i < pos.count; i++)
    if (Math.round(parts.getX(i)) === part) out.push(new Vector3().fromBufferAttribute(pos, i));
  return out;
};

test('every car is 4.4 m long, a real width, and stands on its wheels', () => {
  for (const kind of CAR_KINDS)
    for (const lod of ['near', 'far'] as const) {
      const { box } = boxOf(kind, lod);
      expect(box.max.x - box.min.x, `${kind} ${lod}`).toBeCloseTo(4.4, 1);
      expect(box.max.z - box.min.z).toBeGreaterThan(1.7);
      expect(box.max.z - box.min.z).toBeLessThan(2.0);
      expect(box.min.y).toBeCloseTo(0, 2);
    }
});

test('body styles differ in height', () => {
  const h = (k: (typeof CAR_KINDS)[number]) => boxOf(k, 'near').box.max.y;
  expect(h('sedan')).toBeGreaterThan(1.38);
  expect(h('sedan')).toBeLessThan(1.52);
  expect(h('suv')).toBeGreaterThan(1.65);
  expect(h('van')).toBeGreaterThan(1.85);
});

test('near cars are detailed but cheap; far cars are a handful of triangles', () => {
  for (const kind of CAR_KINDS) {
    expect(tris(carGeometry(kind, 'near'))).toBeLessThanOrEqual(2000);
    expect(tris(carGeometry(kind, 'far'))).toBeLessThanOrEqual(220);
  }
});

test('glass sits above the beltline, tyres touch the ground at the four corners', () => {
  const g = carGeometry('sedan', 'near');
  const glass = partPoints(g, CAR_PART.glass);
  expect(glass.length).toBeGreaterThan(0);
  expect(Math.min(...glass.map(p => p.y))).toBeGreaterThan(0.8);
  const tyre = partPoints(g, CAR_PART.tyre);
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const corner = tyre.filter(p => Math.sign(p.x) === sx && Math.sign(p.z) === sz);
    expect(corner.length).toBeGreaterThan(0);
    expect(Math.min(...corner.map(p => p.y))).toBeCloseTo(0, 2);
  }
});

test('lamp lenses sit where the head and tail lights shine, inside the rounded nose', () => {
  for (const kind of CAR_KINDS) {
    const head = partPoints(carGeometry(kind, 'near'), CAR_PART.lens);
    const tail = partPoints(carGeometry(kind, 'near'), CAR_PART.tail);
    expect(head.length).toBeGreaterThan(0);
    expect(tail.length).toBeGreaterThan(0);
    for (const p of head) expect(p.x).toBeGreaterThan(2.0);
    for (const p of tail) expect(p.x).toBeLessThan(-2.0);
    for (const p of [...head, ...tail]) {
      expect(p.y).toBeGreaterThanOrEqual(CAR_LAMP.y0 - 1e-6);
      expect(p.y).toBeLessThanOrEqual(CAR_LAMP.y1 + 1e-6);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(CAR_LAMP.z1 + 1e-6);
    }
    // The body behind the lamps is at least as tall and wide as the lamps.
    const paint = partPoints(carGeometry(kind, 'near'), CAR_PART.paint).filter(p => p.x > 2.15);
    expect(Math.max(...paint.map(p => p.y)), kind).toBeGreaterThan(CAR_LAMP.y1);
    expect(Math.max(...paint.map(p => Math.abs(p.z)))).toBeGreaterThan(CAR_LAMP.z1);
  }
});

const faces = (g: ReturnType<typeof carGeometry>) => {
  const pos = g.getAttribute('position');
  const parts = g.getAttribute('aPart');
  const out: { c: Vector3; n: Vector3; part: number }[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t);
    b.fromBufferAttribute(pos, t + 1);
    c.fromBufferAttribute(pos, t + 2);
    const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
    if (n.lengthSq() < 1e-12) continue;
    out.push({ c: a.clone().add(b).add(c).divideScalar(3), n: n.normalize(), part: Math.round(parts.getX(t)) });
  }
  return out;
};

test('body panels face outwards', () => {
  for (const kind of CAR_KINDS) {
    const body = faces(carGeometry(kind, 'near')).filter(f => f.part === CAR_PART.paint || f.part === CAR_PART.glass);
    const out = body.filter(f => f.n.dot(new Vector3(f.c.x * 0.15, f.c.y - 0.75, f.c.z)) > 0).length;
    expect(out / body.length, kind).toBeGreaterThan(0.97);
  }
});

test('door panels are smooth, without wedges or flares between the wheels', () => {
  const g = carGeometry('sedan', 'near');
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const parts = g.getAttribute('aPart');
  let checked = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (Math.round(parts.getX(i)) !== CAR_PART.paint || Math.abs(x) > 0.8 || y < 0.4 || y > 0.75 || Math.abs(z) < 0.8)
      continue;
    checked++;
    expect(Math.sign(nor.getZ(i))).toBe(Math.sign(z));
    expect(Math.abs(nor.getZ(i))).toBeGreaterThan(0.9);
  }
  expect(checked).toBeGreaterThan(10);
});

test('wheel wells are dark: nothing painted inside the arches', () => {
  for (const kind of CAR_KINDS) {
    const { x: wx, r } = WHEELS[kind];
    const inside = faces(carGeometry(kind, 'near')).filter(
      f => Math.abs(Math.abs(f.c.x) - wx) < r && f.c.y > r && f.c.y < 2 * r && Math.abs(f.c.z) < 0.75,
    );
    expect(inside.length, kind).toBeGreaterThan(0);
    for (const f of inside) expect(f.part, kind).not.toBe(CAR_PART.paint);
  }
});

test('near cars carry number plates front and back and door mirrors', () => {
  const g = carGeometry('hatch', 'near');
  const plate = partPoints(g, CAR_PART.plate);
  expect(plate.some(p => p.x > 2.15)).toBe(true);
  expect(plate.some(p => p.x < -2.15)).toBe(true);
  g.computeBoundingBox();
  // Mirrors stick out past the 1.8 m body.
  expect(g.boundingBox!.max.z).toBeGreaterThan(0.93);
});

test('the fleet gives detailed bodies only to cars near the camera', () => {
  const cars = Array.from({ length: 40 }, (_, i) => ({
    kind: CAR_KINDS[i % CAR_KINDS.length],
    color: 0x334455,
    matrix: new Matrix4().makeTranslation(i * 10, 0, 0),
  }));
  const fleet = createCarFleet(cars, { castShadow: true });
  fleet.update(new Vector3(0, 2, 0));
  const near = fleet.meshes.filter(m => m.name.endsWith(':near')).reduce((n, m) => n + m.count, 0);
  const far = fleet.meshes.filter(m => m.name.endsWith(':far')).reduce((n, m) => n + m.count, 0);
  expect(near).toBe(cars.filter((_, i) => i * 10 < LOD_NEAR).length);
  expect(near + far).toBe(40);
  expect(fleet.meshes).toHaveLength(CAR_KINDS.length * 2);
  fleet.dispose();
});

test('moving a car moves its instance', () => {
  const fleet = createCarFleet([{ kind: 'sedan', color: 0xffffff, matrix: new Matrix4() }], { castShadow: false });
  fleet.setMatrix(0, new Matrix4().makeTranslation(3, 0, 4));
  fleet.update(new Vector3());
  const mesh = fleet.meshes.find(m => m.count > 0)!;
  const m = new Matrix4();
  mesh.getMatrixAt(0, m);
  expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([3, 0, 4]);
  fleet.dispose();
});

test('alloy rims have spokes: silver spokes with dark gaps between them', () => {
  const { x: wx, r } = WHEELS.sedan;
  const face = faces(carGeometry('sedan', 'near')).filter(
    f => Math.hypot(f.c.x - wx, f.c.y - r) < r * 0.55 && Math.hypot(f.c.x - wx, f.c.y - r) > r * 0.25 && f.c.z > 0.8,
  );
  const silver = face.filter(f => f.part === CAR_PART.chrome).length;
  const dark = face.filter(f => f.part === CAR_PART.tyre).length;
  expect(silver).toBeGreaterThanOrEqual(5);
  expect(dark).toBeGreaterThanOrEqual(5);
});

test('taxis are yellow sedans with a lit roof sign', () => {
  expect(CAR_KINDS).toContain('taxi');
  const height = (k: (typeof CAR_KINDS)[number]) => boxOf(k, 'near').box.max.y;
  expect(height('taxi')).toBeGreaterThan(height('sedan') + 0.08);
  expect(height('taxi')).toBeLessThan(height('sedan') + 0.25);
  const fleet = createCarFleet([{ kind: 'taxi', color: 0x112233, matrix: new Matrix4() }], { castShadow: false });
  fleet.update(new Vector3());
  const mesh = fleet.meshes.find(m => m.count > 0)!;
  const c = new Color();
  mesh.getColorAt(0, c);
  expect(c.getHex()).toBe(TAXI_YELLOW);
  fleet.dispose();
});

test('about one moving car in six is a taxi; parked taxis are rare; every style appears', () => {
  const share = (moving: boolean, kind: string) =>
    Array.from({ length: 960 }, (_, n) => carKindFor(n, moving)).filter(k => k === kind).length / 960;
  expect(share(true, 'taxi')).toBeGreaterThan(0.12);
  expect(share(true, 'taxi')).toBeLessThan(0.22);
  expect(share(false, 'taxi')).toBeGreaterThan(0);
  expect(share(false, 'taxi')).toBeLessThan(0.08);
  for (const kind of CAR_KINDS) expect(share(true, kind) + share(false, kind), kind).toBeGreaterThan(0.05);
  // Neighbours differ often enough that a row of parked cars is not all one style.
  const row = Array.from({ length: 10 }, (_, n) => carKindFor(n, false));
  expect(new Set(row).size).toBeGreaterThanOrEqual(3);
});
