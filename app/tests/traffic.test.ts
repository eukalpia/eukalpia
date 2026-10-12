import { DISTRICTS } from '../src/content/districts';
import { buildCity } from '../src/world/buildings/geometry';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { planClutter, signalState } from '../src/world/street/clutter';
import { CAR_HALF, carPose, createTrafficSim, planSkyways, planTraffic, podPose } from '../src/world/street/traffic';

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
