import { Vector3 } from 'three';
import { createController, type MoveInput } from '../src/character/controller';
import { DISTRICTS } from '../src/content/districts';
import { buildCity } from '../src/world/buildings/geometry';
import { buildCollisionWorld } from '../src/world/collision';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { planFurniture } from '../src/world/street/furniture';

// The real city: the edges of islands, bridges and roofs must hold UR-01 in.
const layout = createLayout(DEFAULT_SEED, DISTRICTS);
const specs = buildCity(layout, DISTRICTS).specs;
const world = buildCollisionWorld(layout, specs, planFurniture(layout, 'high'));
const main = layout.islands[0];
const yawTowards = (dx: number, dz: number) => Math.atan2(-dx, -dz);
const runJump = (jump: boolean): MoveInput => ({ forward: 1, right: 0, run: true, jump });

function play(start: Vector3, dx: number, dz: number, seconds: number, jump = false) {
  const c = createController(world, start);
  c.teleport(start);
  c.yaw = yawTowards(dx, dz);
  for (let t = 0; t < seconds; t += 1 / 60) c.update(1 / 60, runJump(jump && c.grounded));
  return c;
}

const bridges = layout.bridges.map(b => {
  const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
  return { b, ux: (b.bx - b.ax) / len, uz: (b.bz - b.az) / len, len, to: layout.islands.find(i => i.id === b.to)! };
});

test('there is no opening beside a bridge to walk off the rim', () => {
  for (const { b, ux, uz } of bridges)
    for (const side of [-1, 1]) {
      const off = b.width / 2 + 0.7;
      const start = new Vector3(b.ax - ux * 3 - uz * off * side, main.topY + 1, b.az - uz * 3 + ux * off * side);
      const c = play(start, ux, uz, 8);
      expect(c.position.y, `${b.to} side ${side}`).toBeGreaterThan(main.topY - 1);
    }
});

test('a running jump at the rim railing stays on the island', () => {
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const start = new Vector3(dx * (main.radius - 8), main.topY + 1, dz * (main.radius - 8));
    const c = play(start, dx, dz, 5, true);
    expect(Math.hypot(c.position.x, c.position.z)).toBeLessThan(main.radius);
    expect(c.position.y).toBeGreaterThan(main.topY - 1);
  }
});

test('jumping sideways off a bridge is impossible', () => {
  for (const { b, ux, uz, len } of bridges) {
    const mid = new Vector3(b.ax + ux * len * 0.5, Math.max(b.ay, b.by) + 6, b.az + uz * len * 0.5);
    const c = play(mid, -uz, ux, 4, true);
    const deck = world.groundAt(mid.x, mid.z, mid.y)!;
    expect(c.position.y).toBeGreaterThan(deck - 1.5);
  }
});

test('every bridge can be walked across in both directions', () => {
  for (const { b, ux, uz, len, to } of bridges) {
    const there = play(new Vector3(b.ax - ux * 3, main.topY + 1, b.az - uz * 3), ux, uz, len / 4.2 + 6);
    expect(Math.hypot(there.position.x - to.cx, there.position.z - to.cz), `to ${to.id}`).toBeLessThan(to.radius);
    expect(there.position.y).toBeCloseTo(to.topY, 0);
    const back = play(new Vector3(b.bx + ux * 3, to.topY + 1, b.bz + uz * 3), -ux, -uz, len / 4.2 + 6);
    expect(Math.hypot(back.position.x - main.cx, back.position.z - main.cz), `from ${to.id}`).toBeLessThan(main.radius);
    expect(back.position.y).toBeCloseTo(main.topY, 0);
  }
});

test('roof parapets are solid', () => {
  const lmsId = DISTRICTS.find(d => d.name === 'lms.turin.uz')!.id;
  const top = specs.find(s => s.districtId === lmsId)!.tiers.at(-1)!;
  for (const [dx, dz] of [
    [0, 1],
    [0, -1],
    [1, 0],
  ]) {
    const c = play(new Vector3(top.cx, top.y1 + 1, top.cz), dx, dz, 10);
    expect(c.position.y).toBeCloseTo(top.y1, 1);
  }
});
