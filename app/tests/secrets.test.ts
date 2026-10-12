import { Box3, Vector3 } from 'three';
import { DISTRICTS } from '../src/content/districts';
import { SIGNAL_ORDER } from '../src/content/signals';
import { buildCity } from '../src/world/buildings/geometry';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { SECRET_LABELS, createSecrets, planSecrets } from '../src/world/secrets';

const layout = createLayout(DEFAULT_SEED, DISTRICTS);
const specs = buildCity(layout, DISTRICTS).specs;
const plan = planSecrets(layout, specs);
const at = (id: string) => plan.find(p => p.id === id)!;
const specOf = (name: string) => specs.find(s => s.districtId === DISTRICTS.find(d => d.name === name)!.id)!;
const footprint = (s: (typeof specs)[number]) => {
  const t = s.tiers[0];
  return { x0: t.cx - t.width / 2, x1: t.cx + t.width / 2, z0: t.cz - t.depth / 2, z1: t.cz + t.depth / 2 };
};
const inside = (p: Vector3, s: (typeof specs)[number], pad = 0) => {
  const f = footprint(s);
  return p.x > f.x0 - pad && p.x < f.x1 + pad && p.z > f.z0 - pad && p.z < f.z1 + pad;
};

test('all six discoveries have a place, with v1’s hover labels', () => {
  expect(plan.map(p => p.id).sort()).toEqual([...SIGNAL_ORDER].sort());
  expect(SECRET_LABELS).toEqual({
    cat: 'A very suspicious cat',
    monolith: 'The monolith · listen closely',
    override: 'An old-school signal repeater',
    underworld: 'An unmarked elevator · -1',
    cipher: '65 75 6b 61 6c 70 69 61 · a familiar transmission',
    ghost: 'Someone is still awake',
  });
});

test('the cat walks the south parapet of the Admissions roof, where it can be seen', () => {
  const admissions = specOf('qabul.turin.uz');
  const top = admissions.tiers[admissions.tiers.length - 1];
  const cat = at('cat').position;
  // On top of the 1.1 m parapet, on its 0.3 m ledge along the south (+z) edge.
  expect(cat.y).toBeCloseTo(top.y1 + 1.1, 3);
  expect(cat.z).toBeGreaterThan(top.cz + top.depth / 2 - 0.3);
  expect(cat.z).toBeLessThan(top.cz + top.depth / 2);
  expect(Math.abs(cat.x - top.cx)).toBeLessThan(top.width / 2 - 1);
});

test('the monolith is the tallest tower; the unmarked elevator waits at its foot, outside it', () => {
  const tallest = Math.max(...specs.map(s => Math.max(...s.tiers.map(t => t.y1))));
  expect(at('monolith').box.max.y).toBeCloseTo(tallest, 3);
  const monolith = specs.find(s => s.lotId.endsWith('monolith'))!;
  const elevator = at('underworld').position;
  expect(elevator.y).toBeCloseTo(monolith.baseY, 3);
  expect(inside(elevator, monolith)).toBe(false);
  expect(inside(elevator, monolith, 8)).toBe(true);
});

test('the repeater and the beacon stand on open ground of the main island, inside no building', () => {
  for (const id of ['override', 'cipher']) {
    const p = at(id).position;
    expect(p.y, id).toBeCloseTo(layout.islands[0].topY, 3);
    expect(Math.hypot(p.x, p.z), id).toBeLessThan(layout.islands[0].radius - 20);
    for (const s of specs) expect(inside(p, s, 1), `${id} in ${s.lotId}`).toBe(false);
  }
  expect(at('override').position.distanceTo(at('cipher').position)).toBeGreaterThan(80);
});

test('the ghost window is on the north face of Inventar, halfway up', () => {
  const inventar = specOf('inventar.uz');
  const f = footprint(inventar);
  const ghost = at('ghost').position;
  expect(ghost.z).toBeLessThan(f.z0 + 0.01);
  expect(ghost.z).toBeGreaterThan(f.z0 - 0.5);
  const height = Math.max(...inventar.tiers.map(t => t.y1)) - inventar.baseY;
  expect(ghost.y - inventar.baseY).toBeGreaterThan(height * 0.3);
  expect(ghost.y - inventar.baseY).toBeLessThan(height * 0.75);
});

test('every hidden object has a hover box around it', () => {
  for (const p of plan) expect(p.box.containsPoint(p.position), p.id).toBe(true);
});

test('the ghost can only be found at night; the cat only paces once found', () => {
  const secrets = createSecrets(plan);
  const ids = () => secrets.pickables().map(p => (p.target as { id: string }).id);
  expect(ids()).not.toContain('ghost');
  secrets.setNight(true);
  expect(ids()).toContain('ghost');
  const cat = secrets.group.getObjectByName('secret-cat')!;
  const start = cat.position.clone();
  secrets.update(5);
  expect(cat.position.distanceTo(start)).toBeLessThan(1e-6);
  secrets.setCatFound(true);
  secrets.update(5);
  expect(cat.position.distanceTo(start)).toBeGreaterThan(0.1);
  // It never leaves its ledge.
  const home = at('cat').position;
  const box = new Box3().setFromCenterAndSize(home, new Vector3(6.01, 0.01, 0.01));
  for (let t = 0; t < 30; t += 0.7) {
    secrets.update(t);
    expect(box.containsPoint(cat.position)).toBe(true);
  }
  secrets.dispose();
});
