import { BoxGeometry, BufferGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOOM_LENGTH } from '../src/character/cameras';
import { createController, type MoveInput } from '../src/character/controller';
import { DISTRICTS } from '../src/content/districts';
import { CHARACTER_SPAWN } from '../src/engine/camera/orbit';
import { buildCity } from '../src/world/buildings/geometry';
import { buildCollisionWorld, createCollisionWorld } from '../src/world/collision';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { planFurniture } from '../src/world/street/furniture';
import { planClutter } from '../src/world/street/clutter';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BufferGeometry =>
  new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).toNonIndexed();

// A 60x60 m test yard: floor, a wall at x = 10, a 0.30 m kerb at z = 5, a 0.50 m block at z = -5, a railing at x = -10.
function yard() {
  const parts = [
    box(-30, -1, -30, 30, 0, 30),
    box(10, 0, -30, 11, 6, 30),
    box(-5, 0, 5, 5, 0.3, 10),
    box(-5, 0, -10, 5, 0.5, -5),
    box(-10.1, 0, -30, -10, 1.1, 30),
  ].map(g => (g.deleteAttribute('uv'), g.deleteAttribute('normal'), g));
  return createCollisionWorld(mergeGeometries(parts), [{ cx: 0, cz: 0, radius: 30, topY: 0 }]);
}
const still: MoveInput = { forward: 0, right: 0, run: false, jump: false };
const run = (forward: number, right = 0): MoveInput => ({ forward, right, run: true, jump: false });
function simulate(c: ReturnType<typeof createController>, seconds: number, input: MoveInput, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    c.update(1 / 60, input);
    each?.();
  }
}

test('walking into a wall stops at the wall', () => {
  const c = createController(yard(), new Vector3(0, 0, 0));
  c.yaw = -Math.PI / 2; // facing +x
  simulate(c, 3, run(1));
  expect(c.position.x).toBeLessThanOrEqual(10 - 0.32 + 0.02);
  expect(c.position.x).toBeGreaterThan(9);
});

test('a 0.30 m kerb is stepped up, a 0.50 m block is not', () => {
  const up = createController(yard(), new Vector3(0, 0, 2));
  up.yaw = Math.PI; // facing +z
  let onKerb = -1;
  simulate(up, 2, run(1), () => {
    if (up.position.z > 6 && up.position.z < 9) onKerb = up.position.y;
  });
  expect(onKerb).toBeCloseTo(0.3, 2);

  const blocked = createController(yard(), new Vector3(0, 0, -2));
  blocked.yaw = 0; // facing -z
  simulate(blocked, 2, run(1));
  expect(blocked.position.y).toBeLessThan(0.05);
  expect(blocked.position.z).toBeGreaterThan(-5);
});

test('fast running into a railing never tunnels through', () => {
  const c = createController(yard(), new Vector3(-5, 0, 0));
  c.yaw = Math.PI / 2 - 0.5; // mostly -x
  simulate(c, 10, run(1), () => expect(c.position.x).toBeGreaterThan(-10));
});

test('a jump peaks at about 1.1 m', () => {
  const c = createController(yard(), new Vector3(0, 0, -20));
  simulate(c, 0.3, still);
  const y0 = c.position.y;
  let peak = y0;
  c.update(1 / 60, { ...still, jump: true });
  simulate(c, 1.5, still, () => (peak = Math.max(peak, c.position.y)));
  expect(peak - y0).toBeGreaterThan(1.0);
  expect(peak - y0).toBeLessThan(1.2);
  expect(c.grounded).toBe(true);
});

test('teleporting over the void lands on the nearest island', () => {
  const c = createController(yard(), new Vector3(0, 0, 0));
  c.teleport(new Vector3(0, 0, 80));
  simulate(c, 0.5, still);
  expect(c.grounded).toBe(true);
  expect(Math.hypot(c.position.x, c.position.z)).toBeLessThan(30);
});

test('real city spawn points stand on ground', () => {
  const layout = createLayout(DEFAULT_SEED, DISTRICTS);
  const world = buildCollisionWorld(layout, buildCity(layout, DISTRICTS).specs, planFurniture(layout, 'high'));
  expect(world.groundAt(CHARACTER_SPAWN.x, CHARACTER_SPAWN.z, 50)).toBeCloseTo(0, 2);
  expect(world.groundAt(0, 380, 50)).toBeNull();
});

test('walking starts with a clear view: no tree or lamp between the camera and UR-01, or right ahead of it', () => {
  const layout = createLayout(DEFAULT_SEED, DISTRICTS);
  const plan = planFurniture(layout, 'high');
  // UR-01 faces +z; the boom camera hangs BOOM_LENGTH behind, and the view runs 8 m ahead.
  const z0 = CHARACTER_SPAWN.z - BOOM_LENGTH - 0.5;
  const z1 = CHARACTER_SPAWN.z + 8;
  for (const t of [...plan.trees, ...plan.lamps]) {
    const inCorridor = t.z > z0 && t.z < z1 && Math.abs(t.x - CHARACTER_SPAWN.x) < 1.2;
    expect(inCorridor, `${t.x.toFixed(1)}, ${t.z.toFixed(1)}`).toBe(false);
  }
});

test('signal poles are solid', () => {
  const layout = createLayout(DEFAULT_SEED, DISTRICTS);
  const specs = buildCity(layout, DISTRICTS).specs;
  const pole = planClutter(layout, specs).signals[0];
  const world = buildCollisionWorld(layout, specs, planFurniture(layout, 'high'), [pole]);
  const hit = world.raycast(new Vector3(pole.x - 3, pole.y + 1.2, pole.z), new Vector3(1, 0, 0), 5);
  expect(hit).not.toBeNull();
  expect(hit!).toBeCloseTo(2.9, 1);
});

test('a fall into the void puts UR-01 back where they last stood', () => {
  // The yard has no railing on its −z edge: run off it, then let go of the keys.
  const c = createController(yard(), new Vector3(20, 0.5, 0));
  c.yaw = 0; // facing −z
  simulate(c, 9, run(1));
  simulate(c, 6, still);
  expect(c.grounded).toBe(true);
  expect(c.position.y).toBeCloseTo(0, 2);
  expect(c.position.z).toBeGreaterThan(-30);
});
