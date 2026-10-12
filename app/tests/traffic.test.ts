import { DISTRICTS } from '../src/content/districts';
import { buildCity } from '../src/world/buildings/geometry';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { planClutter, signalState } from '../src/world/street/clutter';
import { CAR_LAMP } from '../src/world/street/cars';
import {
  CAR_HALF,
  carPose,
  createTrafficSim,
  lightsGeometry,
  heroPodPose,
  planSkyways,
  planTraffic,
  podPose,
  poseOnLoop,
} from '../src/world/street/traffic';

const L = createLayout(DEFAULT_SEED, DISTRICTS);
const specs = buildCity(L, DISTRICTS).specs;
const routes = planTraffic(L, 260);

test('the requested number of cars is planned', () => expect(routes).toHaveLength(260));

test('cars stay on their street and in a lane', () => {
  for (const r of routes.slice(0, 80)) {
    const s = r.street;
    const vertical = Math.abs(s.ax - s.bx) < 1e-6;
    for (let t = 0; t < 120; t += 0.7) {
      const p = carPose(r, t);
      const across = vertical ? p.x - s.ax : p.z - s.az;
      expect(Math.abs(Math.abs(across) - s.width / 4)).toBeLessThan(0.5);
      const along = vertical ? p.z : p.x;
      expect(along).toBeGreaterThanOrEqual(Math.min(vertical ? s.az : s.ax, vertical ? s.bz : s.bx) - 0.01);
      expect(along).toBeLessThanOrEqual(Math.max(vertical ? s.az : s.ax, vertical ? s.bz : s.bx) + 0.01);
    }
  }
});

test('cars on the same street never overlap', () => {
  const byStreet = new Map<unknown, typeof routes>();
  for (const r of routes) byStreet.set(r.street, [...(byStreet.get(r.street) ?? []), r]);
  for (const list of byStreet.values())
    for (let t = 0; t < 60; t += 1.3)
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = carPose(list[i], t);
          const b = carPose(list[j], t);
          expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(5);
        }
});

test('cars face along their direction of travel', () => {
  const r = routes[0];
  const a = carPose(r, 10);
  const b = carPose(r, 10.05);
  const heading = Math.atan2(-(b.z - a.z), b.x - a.x);
  expect(Math.abs(Math.atan2(Math.sin(heading - a.rotY), Math.cos(heading - a.rotY)))).toBeLessThan(0.05);
});

test('skyways never cut through a tower', () => {
  const ways = planSkyways(DEFAULT_SEED, specs);
  expect(ways).toHaveLength(6);
  for (const w of ways)
    for (let k = 0; k < 360; k++) {
      const p = podPose(w, 0, ((k / 360) * (2 * Math.PI * w.radius)) / w.speed);
      for (const s of specs)
        for (const t of s.tiers) {
          const inside = Math.abs(p.x - t.cx) < t.width / 2 + 15 && Math.abs(p.z - t.cz) < t.depth / 2 + 15;
          if (inside) expect(p.y).toBeGreaterThan(t.y1 + 15 + (s.crown === 'flat' ? 0 : 45));
        }
    }
});

describe('traffic obeys the signals', () => {
  const crossings = planClutter(L, specs).crossings;
  const sim = createTrafficSim(routes, crossings);
  const dt = 1 / 30;
  const start = sim.cars.map(c => c.d);
  const travelled = sim.cars.map(() => 0);
  const runs: string[] = [];
  let minGap = Infinity;
  let mostStanding = 0;
  for (let k = 1; k <= 120 * 30; k++) {
    const t = k * dt;
    const before = sim.cars.map(c => c.d);
    sim.step(dt, t);
    let standing = 0;
    sim.cars.forEach((c, i) => {
      const loop = 2 * c.length;
      const moved = (c.d - before[i] + loop) % loop;
      travelled[i] += moved;
      if (c.v < 0.05) standing++;
      const front = (before[i] + CAR_HALF) % loop;
      for (const line of sim.stopLines(c)) {
        const rel = (line.at - front + loop) % loop;
        if (rel > 0 && rel <= moved && signalState(crossings[line.crossing], t)[line.axis] === 'red')
          runs.push(`car ${i} at t=${t.toFixed(2)}`);
      }
    });
    mostStanding = Math.max(mostStanding, standing);
    for (const group of sim.streets()) {
      const sorted = [...group].sort((a, b) => a.d - b.d);
      const loop = 2 * sorted[0].length;
      for (let i = 0; i < sorted.length && sorted.length > 1; i++) {
        const a = sorted[i];
        const b = sorted[(i + 1) % sorted.length];
        minGap = Math.min(minGap, (b.d - a.d + loop) % loop);
      }
    }
  }

  test('no car crosses a stop line on red', () => expect(runs).toEqual([]));
  test('queues form at red lights', () => expect(mostStanding).toBeGreaterThan(15));
  test('cars keep a gap to the car ahead', () => expect(minGap).toBeGreaterThan(2 * CAR_HALF + 1));
  test('traffic keeps flowing', () => {
    expect(start).toHaveLength(routes.length);
    for (const d of travelled) expect(d).toBeGreaterThan(240);
  });
});

test('cars on crossing streets never meet, anywhere', () => {
  const crossings = planClutter(L, specs).crossings;
  const sim = createTrafficSim(routes, crossings);
  const meets: string[] = [];
  const dt = 1 / 20;
  for (let k = 1; k <= 300 * 20; k++) {
    sim.step(dt, k * dt);
    if (k % 10) continue;
    const cells = new Map<string, { x: number; z: number; vertical: boolean }[]>();
    for (const car of sim.cars) {
      const p = poseOnLoop(car.route.street, car.d);
      const vertical = Math.abs(car.route.street.ax - car.route.street.bx) < 1e-6;
      const key = `${Math.floor(p.x / 8)}:${Math.floor(p.z / 8)}`;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const o of cells.get(`${Math.floor(p.x / 8) + i}:${Math.floor(p.z / 8) + j}`) ?? [])
            if (o.vertical !== vertical && Math.hypot(o.x - p.x, o.z - p.z) < 3.5)
              meets.push(`${p.x.toFixed(0)},${p.z.toFixed(0)} at ${(k * dt).toFixed(1)}s`);
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push({ x: p.x, z: p.z, vertical });
    }
  }
  expect(meets.slice(0, 5)).toEqual([]);
});

test('cars turn around on the asphalt, not on the rim promenade', () => {
  for (const r of routes) {
    const island = L.islands.find(i => i.id === r.street.islandId)!;
    for (const end of [
      [r.street.ax, r.street.az],
      [r.street.bx, r.street.bz],
    ])
      expect(Math.hypot(end[0] - island.cx, end[1] - island.cz)).toBeLessThanOrEqual(island.radius - 14);
  }
});

test('head and tail glow sits on the car lamp lenses, inside the body outline', () => {
  for (const front of [true, false]) {
    const g = lightsGeometry(front);
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.min.y).toBeGreaterThanOrEqual(CAR_LAMP.y0 - 1e-6);
    expect(box.max.y).toBeLessThanOrEqual(CAR_LAMP.y1 + 1e-6);
    expect(box.max.z).toBeLessThanOrEqual(CAR_LAMP.z1 + 1e-6);
    expect(front ? box.min.x : -box.max.x).toBeGreaterThan(2.2);
    expect(front ? box.max.x : -box.min.x).toBeLessThan(2.25);
  }
});

test('UR-07, the hero air taxi, is the first pod of the first skyway', () => {
  const ways = planSkyways(DEFAULT_SEED, specs);
  for (const t of [0, 12.5, 300]) expect(heroPodPose(ways, t)).toEqual(podPose(ways[0], 0, t));
});
