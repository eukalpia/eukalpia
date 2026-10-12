import { Vector3 } from 'three';
import { createController, type MoveInput } from '../src/character/controller';
import { DISTRICTS } from '../src/content/districts';
import { buildCity } from '../src/world/buildings/geometry';
import { buildCollisionWorld } from '../src/world/collision';
import { streetRect } from '../src/world/ground/groundMask';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { LIFT_SPEED, createLift, liftColliders, planLift } from '../src/world/lift';
import { planFurniture } from '../src/world/street/furniture';

const L = createLayout(DEFAULT_SEED, DISTRICTS);
const specs = buildCity(L, DISTRICTS).specs;
const lmsId = DISTRICTS.find(d => d.name === 'lms.turin.uz')!.id;
const lms = specs.find(s => s.districtId === lmsId)!;
const plan = planLift(lms, L);
const furniture = planFurniture(L, 'high');
const fresh = () => {
  const world = buildCollisionWorld(L, specs, furniture, [], liftColliders(plan));
  return { world, lift: createLift(plan, world) };
};
const idle: MoveInput = { forward: 0, right: 0, run: false, jump: false };
const walk: MoveInput = { forward: 1, right: 0, run: false, jump: false };
const dt = 1 / 60;
/** Yaw whose forward direction is (dx, dz); the controller looks down −z at yaw 0. */
const yawTowards = (dx: number, dz: number) => Math.atan2(-dx, -dz);

test('the shaft stands outside the tower on its street side, off the road', () => {
  const t = lms.tiers[0];
  const outside = Math.abs(plan.x - t.cx) > t.width / 2 + 1.4 || Math.abs(plan.z - t.cz) > t.depth / 2 + 1.4;
  expect(outside).toBe(true);
  for (const r of L.streets.map(streetRect))
    expect(plan.x + 1.5 < r.x0 || plan.x - 1.5 > r.x1 || plan.z + 1.5 < r.z0 || plan.z - 1.5 > r.z1).toBe(true);
  expect(plan.roofFloorY).toBeCloseTo(lms.tiers[lms.tiers.length - 1].y1, 5);
  expect(plan.roofY).toBeGreaterThan(plan.roofFloorY);
  for (const tree of furniture.trees) expect(Math.hypot(tree.x - plan.x, tree.z - plan.z)).toBeGreaterThan(3);
});

test('the lift reaches the roof and stops flush', () => {
  const { lift } = fresh();
  expect(lift.update(0)).toBeCloseTo(plan.streetY, 5);
  lift.call('roof');
  let y = plan.streetY;
  let fastest = 0;
  let t = 0;
  for (; t < 120; t += dt) {
    const next = lift.update(dt);
    fastest = Math.max(fastest, (next - y) / dt);
    y = next;
    if (!lift.moving) break;
  }
  expect(y).toBeCloseTo(plan.roofY, 3);
  expect(fastest).toBeLessThanOrEqual(LIFT_SPEED + 1e-6);
  expect(t).toBeLessThan(40);
  for (let k = 0; k < 60; k++) expect(lift.update(dt)).toBeCloseTo(plan.roofY, 3);
});

test('a rider on the platform rises with it and walks out onto the roof', () => {
  const { world, lift } = fresh();
  const c = createController(world, new Vector3(plan.x, plan.streetY + 1, plan.z));
  for (let k = 0; k < 30; k++) c.update(dt, idle);
  lift.call('roof');
  for (let t = 0; t < 120 && lift.moving; t += dt) {
    const y = lift.update(dt);
    c.update(dt, idle);
    expect(Math.abs(c.position.y - y)).toBeLessThan(0.02);
  }
  expect(c.position.y).toBeCloseTo(plan.roofY, 2);
  for (let k = 0; k < 60; k++) lift.update(dt);
  c.yaw = yawTowards(-plan.nx, -plan.nz);
  for (let k = 0; k < 6 * 60; k++) {
    lift.update(dt);
    c.update(dt, walk);
  }
  expect(c.grounded).toBe(true);
  expect(c.position.y).toBeCloseTo(plan.roofFloorY, 1);
});

test('closed doors keep riders out of an empty shaft', () => {
  const { world, lift } = fresh();
  // The platform waits at the street; a rider on the bridge walks towards the shaft.
  const start = new Vector3(plan.x - plan.nx * 4, plan.roofY + 0.5, plan.z - plan.nz * 4);
  const c = createController(world, start);
  c.yaw = yawTowards(plan.nx, plan.nz);
  for (let k = 0; k < 5 * 60; k++) {
    lift.update(dt);
    c.update(dt, walk);
  }
  expect(c.position.y).toBeCloseTo(plan.roofY, 1);
  // At street level, with the platform up at the roof, the street door is shut too.
  lift.call('roof');
  for (let k = 0; k < 120 * 60 && lift.moving; k++) lift.update(dt);
  const street = new Vector3(plan.x + plan.nx * 4, plan.streetY + 1, plan.z + plan.nz * 4);
  const d = createController(world, street);
  d.yaw = yawTowards(-plan.nx, -plan.nz);
  for (let k = 0; k < 5 * 60; k++) {
    lift.update(dt);
    d.update(dt, walk);
  }
  const inShaft = Math.abs(d.position.x - plan.x) < 1.3 && Math.abs(d.position.z - plan.z) < 1.3;
  expect(inShaft).toBe(false);
});

test('status labels follow the ride', () => {
  const { lift } = fresh();
  const far = new Vector3(plan.x + 60, plan.streetY, plan.z + 60);
  expect(lift.status(far)).toEqual({ available: false, label: 'LMS lift · locating…' });
  const onboard = new Vector3(plan.x, plan.streetY, plan.z);
  expect(lift.status(onboard)).toEqual({ available: true, label: 'Ride to LMS roof' });
  lift.press(onboard);
  expect(lift.status(onboard).label).toBe('Lift ascending');
  const seen = new Set<string>();
  for (let t = 0; t < 120 && lift.moving; t += dt) {
    const y = lift.update(dt);
    seen.add(lift.status(new Vector3(plan.x, y, plan.z)).label);
  }
  expect(seen.has('Lift arriving')).toBe(true);
  for (let k = 0; k < 120; k++) lift.update(dt);
  expect(lift.status(new Vector3(plan.x, plan.roofY, plan.z))).toEqual({ available: true, label: 'Ride to street' });
  const waiting = new Vector3(plan.x + plan.nx * 3, plan.streetY, plan.z + plan.nz * 3);
  expect(lift.status(waiting)).toEqual({ available: true, label: 'Call LMS lift' });
  lift.press(waiting);
  expect(lift.status(waiting).label).toBe('Lift descending');
});

test('a rider stays on the platform through a long frame at full speed', () => {
  const { world, lift } = fresh();
  const c = createController(world, new Vector3(plan.x, plan.streetY + 1, plan.z));
  for (let k = 0; k < 30; k++) c.update(dt, idle);
  lift.call('roof');
  let y = plan.streetY;
  while (y < plan.streetY + 80) {
    y = lift.update(dt, c);
    c.update(dt, idle);
  }
  y = lift.update(0.1, c);
  c.update(0.1, idle);
  expect(Math.abs(c.position.y - y)).toBeLessThan(0.02);
});
