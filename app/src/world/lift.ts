import {
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { SunRig } from '../engine/lighting/sun';
import type { BuildingSpec } from './buildings/massing';
import { solidBox, type CollisionWorld, type Mover } from './collision';
import { streetRect } from './ground/groundMask';
import type { CityLayout } from './layout';
import { LocalBuilder } from './localBuilder';
import { planFurniture } from './street/furniture';

/** Express panoramic lift: top speed and acceleration. */
export const LIFT_SPEED = 9;
const LIFT_ACCEL = 1.4;
/** Shaft inner width, wall thickness and the gap to the facade (clears the cornice). */
const INNER = 2.6;
const WALL = 0.1;
const GAP = 0.4;
const PLATFORM = 2.4;
const DOOR_HEIGHT = 2.6;
const CAP = 3.4;
const DOOR_TIME = 0.8;
const ARRIVING = 14;
const BRIDGE_WIDTH = 2;
const PARAPET = 1.1;
const STAIR_RUN = 0.35;
const HALF = INNER / 2 + WALL;

export type LiftStop = 'street' | 'roof';

export interface LiftPlan {
  lotId: string;
  /** Shaft centre. */
  x: number;
  z: number;
  /** Outward normal of the facade the shaft stands on (towards the street), and the direction along it. */
  nx: number;
  nz: number;
  ux: number;
  uz: number;
  streetY: number;
  /** The upper stop: level with the top of the roof parapet. */
  roofY: number;
  /** The roof of the top tier, three short steps below the landing. */
  roofFloorY: number;
  /** From the shaft's inner wall to the end of the landing over the parapet. */
  bridge: number;
  steps: number;
}

interface Face {
  nx: number;
  nz: number;
  /** Distance from the tier centre to this face, and the half length of the face. */
  out: number;
  half: number;
}

function faces(t: { width: number; depth: number }): Face[] {
  // East first, as the brief asks; the shaft goes on the first face that fronts a street.
  return [
    { nx: 1, nz: 0, out: t.width / 2, half: t.depth / 2 },
    { nx: -1, nz: 0, out: t.width / 2, half: t.depth / 2 },
    { nx: 0, nz: -1, out: t.depth / 2, half: t.width / 2 },
    { nx: 0, nz: 1, out: t.depth / 2, half: t.width / 2 },
  ];
}

/** Places the LMS lift: a glass shaft against the street-facing facade, clear of trees and lamps. */
export function planLift(spec: BuildingSpec, layout: CityLayout): LiftPlan {
  const base = spec.tiers[0];
  const top = spec.tiers[spec.tiers.length - 1];
  const lot = layout.lots.find(l => l.id === spec.lotId)!;
  const rects = layout.streets.map(streetRect);
  const onStreet = (x: number, z: number) => rects.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const lotOut = (f: Face) => (f.nx !== 0 ? lot.width / 2 : lot.depth / 2);
  const face =
    faces(base).find(f => {
      const probe = lotOut(f) + 3 + 4 + 0.6;
      return onStreet(lot.x + f.nx * probe, lot.z + f.nz * probe);
    }) ?? faces(base)[0];
  const ux = -face.nz;
  const uz = face.nx;
  const centre = face.out + GAP + HALF;

  // Slide along the facade to the spot farthest from street trees, lamps and benches.
  const furniture = planFurniture(layout, 'high');
  const obstacles = [...furniture.trees, ...furniture.lamps, ...furniture.benches];
  let best = { along: 0, clear: -Infinity };
  for (let along = -face.half + HALF + 1; along <= face.half - HALF - 1; along += 0.5) {
    const x = base.cx + face.nx * centre + ux * along;
    const z = base.cz + face.nz * centre + uz * along;
    const clear = Math.min(...obstacles.map(o => Math.hypot(o.x - x, o.z - z)));
    if (clear > best.clear + 1e-6 || (Math.abs(clear - best.clear) < 1e-6 && Math.abs(along) < Math.abs(best.along)))
      best = { along, clear };
  }

  // The top tier's face on the same side; the landing reaches just past its parapet.
  const topOut = face.nx !== 0 ? top.width / 2 : top.depth / 2;
  const topFace = (face.nx !== 0 ? top.cx - base.cx : top.cz - base.cz) * (face.nx + face.nz) + topOut;
  const innerWall = face.out + GAP;
  return {
    lotId: spec.lotId,
    x: base.cx + face.nx * centre + ux * best.along,
    z: base.cz + face.nz * centre + uz * best.along,
    nx: face.nx,
    nz: face.nz,
    ux,
    uz,
    streetY: spec.baseY,
    roofY: top.y1 + PARAPET,
    roofFloorY: top.y1,
    bridge: innerWall - topFace + 0.35,
    steps: 4,
  };
}

/** Maps a box given in shaft coordinates (a along the facade, b out from it, y up) to a world AABB. */
function frameBox(p: LiftPlan, a0: number, a1: number, b0: number, b1: number, y0: number, y1: number): Box3 {
  const xs = [p.x + p.ux * a0 + p.nx * b0, p.x + p.ux * a1 + p.nx * b1];
  const zs = [p.z + p.uz * a0 + p.nz * b0, p.z + p.uz * a1 + p.nz * b1];
  return new Box3(new Vector3(Math.min(...xs), y0, Math.min(...zs)), new Vector3(Math.max(...xs), y1, Math.max(...zs)));
}

const stairRise = (p: LiftPlan) => (p.roofY - p.roofFloorY) / p.steps;

/** Static solids: shaft walls with door openings, cap, bridge deck, its railings and the stair. */
function staticBoxes(p: LiftPlan): Box3[] {
  const h = INNER / 2;
  const top = p.roofY + CAP;
  const boxes = [
    // Side walls, full height.
    frameBox(p, -h - WALL, -h, -h - WALL, h + WALL, p.streetY, top),
    frameBox(p, h, h + WALL, -h - WALL, h + WALL, p.streetY, top),
    // Street side: open below the door head.
    frameBox(p, -h, h, h, h + WALL, p.streetY + DOOR_HEIGHT, top),
    // Building side: open at the roof landing.
    frameBox(p, -h, h, -h - WALL, -h, p.streetY, p.roofY),
    frameBox(p, -h, h, -h - WALL, -h, p.roofY + DOOR_HEIGHT, top),
    frameBox(p, -h - WALL, h + WALL, -h - WALL, h + WALL, top, top + 0.3),
  ];
  // Bridge from the shaft's building-side wall across to the landing, with railings.
  const b0 = -h - WALL;
  const b1 = -h - WALL - p.bridge;
  const w = BRIDGE_WIDTH / 2;
  boxes.push(frameBox(p, -w, w, b1, b0, p.roofY - 0.3, p.roofY));
  for (const s of [-1, 1]) boxes.push(frameBox(p, s * w - 0.05, s * w + 0.05, b1, b0, p.roofY, p.roofY + 1.1));
  // Steps down from the landing onto the roof.
  const rise = stairRise(p);
  for (let k = 1; k < p.steps; k++) {
    const b = b1 - (k - 1) * STAIR_RUN;
    boxes.push(frameBox(p, -w, w, b - STAIR_RUN, b, p.roofFloorY, p.roofY - k * rise));
  }
  return boxes;
}

export function liftColliders(p: LiftPlan): BufferGeometry[] {
  return staticBoxes(p).map(b => solidBox(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z));
}

export interface LiftStatus {
  available: boolean;
  label: string;
}

export interface Lift {
  group: Group;
  readonly moving: boolean;
  status(rider: Vector3): LiftStatus;
  call(at: LiftStop): void;
  /** What the L key does: call the lift to the rider, or ride it to the other stop. */
  press(rider: Vector3): void;
  /** Advances the lift, carrying a rider who stands on the platform; returns the platform's top height. */
  update(dt: number, rider?: { position: Vector3; velocity: Vector3 }): number;
  setNight(night: boolean): void;
  dispose(): void;
}

type State = 'idle' | 'closing' | 'travel' | 'opening';

export function createLift(plan: LiftPlan, collision: CollisionWorld, ctx?: { sun: SunRig }): Lift {
  const stopY = (s: LiftStop) => (s === 'street' ? plan.streetY : plan.roofY);
  let y = plan.streetY;
  let speed = 0;
  let target = y;
  let state: State = 'idle';
  /** 1 = the doors at the platform's stop are open. */
  let doors = 1;
  const at = (): LiftStop | null =>
    Math.abs(y - plan.streetY) < 1e-4 ? 'street' : Math.abs(y - plan.roofY) < 1e-4 ? 'roof' : null;

  // Moving solids: the platform, and a door at each stop that is shut unless the platform waits there.
  const h = INNER / 2;
  const platformBox = new Box3();
  const streetDoor = frameBox(plan, -h, h, h, h + WALL, plan.streetY, plan.streetY + DOOR_HEIGHT);
  const roofDoor = frameBox(plan, -h, h, -h - WALL, -h, plan.roofY, plan.roofY + DOOR_HEIGHT);
  const live: Box3[] = [];
  const mover: Mover = {
    boxes() {
      live.length = 0;
      const half = PLATFORM / 2;
      live.push(platformBox.copy(frameBox(plan, -half, half, -half, half, y - 0.25, y)));
      const open = state === 'idle' || state === 'opening' ? at() : null;
      const ajar = doors > 0.5;
      if (!(open === 'street' && ajar)) live.push(streetDoor);
      if (!(open === 'roof' && ajar)) live.push(roofDoor);
      return live;
    },
  };
  collision.movers.push(mover);

  const local = (r: Vector3) => {
    const dx = r.x - plan.x;
    const dz = r.z - plan.z;
    return { a: dx * plan.ux + dz * plan.uz, b: dx * plan.nx + dz * plan.nz };
  };
  const onPlatform = (r: Vector3) => {
    const { a, b } = local(r);
    return Math.abs(a) <= PLATFORM / 2 && Math.abs(b) <= PLATFORM / 2 && Math.abs(r.y - y) < 0.3;
  };
  const nearStop = (r: Vector3): LiftStop | null => {
    const { a, b } = local(r);
    if (Math.abs(r.y - plan.streetY) < 2 && Math.abs(a) < 5 && b > -HALF && b < 6) return 'street';
    if (Math.abs(r.y - plan.roofY) < 2.5 && Math.abs(a) < 5 && b < HALF && b > -HALF - plan.bridge - 6) return 'roof';
    return null;
  };

  const group = new Group();
  group.name = 'LmsLift';
  const visuals = buildVisuals(plan, ctx);
  group.add(visuals.static, visuals.cab);

  const lift: Lift = {
    group,
    get moving() {
      return state === 'closing' || state === 'travel';
    },
    status(r) {
      if (state === 'closing' || state === 'travel') {
        if (state === 'travel' && Math.abs(target - y) < ARRIVING) return { available: false, label: 'Lift arriving' };
        return { available: false, label: target > y ? 'Lift ascending' : 'Lift descending' };
      }
      if (state === 'opening') return { available: false, label: 'Lift arriving' };
      const stop = nearStop(r);
      if (!stop) return { available: false, label: 'LMS lift · locating…' };
      if (at() !== stop) return { available: true, label: 'Call LMS lift' };
      return { available: onPlatform(r), label: stop === 'street' ? 'Ride to LMS roof' : 'Ride to street' };
    },
    call(stop) {
      if (lift.moving || Math.abs(stopY(stop) - y) < 1e-4) return;
      target = stopY(stop);
      state = 'closing';
    },
    press(r) {
      const s = lift.status(r);
      if (!s.available) return;
      const stop = nearStop(r)!;
      lift.call(s.label === 'Call LMS lift' ? stop : stop === 'street' ? 'roof' : 'street');
    },
    update(dt, rider) {
      const before = y;
      const carried = rider !== undefined && onPlatform(rider.position) && rider.velocity.y <= 0;
      if (state === 'closing') {
        doors = Math.max(0, doors - dt / DOOR_TIME);
        if (doors === 0) state = 'travel';
      } else if (state === 'travel') {
        const dist = target - y;
        const dir = Math.sign(dist);
        // Accelerate up to top speed; brake along the curve that stops exactly at the landing.
        const brakeLimit = Math.sqrt(2 * LIFT_ACCEL * Math.abs(dist));
        speed = Math.min(LIFT_SPEED, brakeLimit, speed + LIFT_ACCEL * dt);
        const step = Math.max(speed, 0.05) * dt;
        if (step >= Math.abs(dist)) {
          y = target;
          speed = 0;
          state = 'opening';
        } else y += dir * step;
      } else if (state === 'opening') {
        doors = Math.min(1, doors + dt / DOOR_TIME);
        if (doors === 1) state = 'idle';
      }
      if (carried && y !== before) {
        rider.position.y = y;
        rider.velocity.y = 0;
      }
      visuals.place(y, doors, at());
      return y;
    },
    setNight(night) {
      visuals.setNight(night);
    },
    dispose() {
      const i = collision.movers.indexOf(mover);
      if (i >= 0) collision.movers.splice(i, 1);
      visuals.dispose();
    },
  };
  visuals.place(y, doors, at());
  return lift;
}

/** Steel frame and glass shaft, the cab, sliding doors, the bridge and its stair. */
function buildVisuals(plan: LiftPlan, ctx?: { sun: SunRig }) {
  const h = INNER / 2;
  const top = plan.roofY + CAP;
  const steel = new LocalBuilder();
  const glass = new LocalBuilder();
  const frame = (a0: number, a1: number, b0: number, b1: number, y0: number, y1: number, into: LocalBuilder) => {
    const box = frameBox(plan, a0, a1, b0, b1, y0, y1);
    into.frame(0, 0, 0, 0).box(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
  };
  // Corner posts, ring girders every 4 m, cap and machine room.
  for (const a of [-h - WALL, h])
    for (const b of [-h - WALL, h]) frame(a, a + WALL + 0.06, b, b + WALL + 0.06, plan.streetY, top, steel);
  for (let yy = plan.streetY + DOOR_HEIGHT; yy < top; yy += 4) {
    frame(-h - WALL, h + WALL, -h - WALL, -h, yy, yy + 0.14, steel);
    frame(-h - WALL, h + WALL, h, h + WALL, yy, yy + 0.14, steel);
    frame(-h - WALL, -h, -h, h, yy, yy + 0.14, steel);
    frame(h, h + WALL, -h, h, yy, yy + 0.14, steel);
  }
  frame(-h - WALL - 0.1, h + WALL + 0.1, -h - WALL - 0.1, h + WALL + 0.1, top, top + 0.3, steel);
  frame(-h + 0.2, h - 0.2, -h + 0.2, h - 0.2, top + 0.3, top + 2.2, steel);
  // Glass on the two sides and the street face above the door; the building side stays open.
  frame(-h - WALL + 0.03, -h - 0.03, -h, h, plan.streetY, top, glass);
  frame(h + 0.03, h + WALL - 0.03, -h, h, plan.streetY, top, glass);
  frame(-h, h, h + 0.03, h + WALL - 0.03, plan.streetY + DOOR_HEIGHT, top, glass);
  // Bridge deck, railings and the stair over the parapet.
  const w = BRIDGE_WIDTH / 2;
  const b0 = -h - WALL;
  const b1 = b0 - plan.bridge;
  frame(-w, w, b1, b0, plan.roofY - 0.3, plan.roofY, steel);
  for (const s of [-1, 1]) {
    frame(s * w - 0.04, s * w + 0.04, b1, b0, plan.roofY + 1.0, plan.roofY + 1.08, steel);
    for (let b = b0 - 0.3; b > b1; b -= 1.2)
      frame(s * w - 0.03, s * w + 0.03, b - 0.06, b, plan.roofY, plan.roofY + 1.0, steel);
    frame(s * w - 0.015, s * w + 0.015, b1, b0, plan.roofY + 0.05, plan.roofY + 1.0, glass);
  }
  const rise = stairRise(plan);
  for (let k = 1; k < plan.steps; k++) {
    const b = b1 - (k - 1) * STAIR_RUN;
    frame(-w, w, b - STAIR_RUN, b, plan.roofY - k * rise - 0.06, plan.roofY - k * rise, steel);
  }

  // The cab: floor, glass balustrades on the closed sides, a crosshead with a light strip.
  const cabSteel = new LocalBuilder();
  const cabGlass = new LocalBuilder();
  const cabLight = new LocalBuilder();
  const p = PLATFORM / 2;
  const cabFrame = (into: LocalBuilder, a0: number, a1: number, b0: number, b1: number, y0: number, y1: number) => {
    const box = frameBox({ ...plan, x: 0, z: 0 }, a0, a1, b0, b1, y0, y1);
    into.frame(0, 0, 0, 0).box(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
  };
  cabFrame(cabSteel, -p, p, -p, p, -0.25, 0);
  for (const s of [-1, 1]) {
    cabFrame(cabSteel, s * p - 0.05, s * p + 0.05, -p, p, 1.0, 1.08);
    cabFrame(cabGlass, s * p - 0.015, s * p + 0.015, -p, p, 0.02, 1.0);
    cabFrame(cabSteel, s * p - 0.06, s * p + 0.06, -0.06, 0.06, 0, 3.3);
  }
  cabFrame(cabSteel, -p - 0.06, p + 0.06, -0.12, 0.12, 3.3, 3.5);
  cabFrame(cabLight, -p + 0.1, p - 0.1, -0.05, 0.05, 3.26, 3.3);
  for (const s of [-1, 1]) cabFrame(cabLight, s * p - 0.02, s * p + 0.02, -p + 0.1, p - 0.1, 1.08, 1.1);

  // Sliding doors: two glass leaves per stop.
  const leaf = new LocalBuilder();
  const leafW = INNER / 2;
  const leafFrame = (b0: number, b1: number) => {
    const box = frameBox({ ...plan, x: 0, z: 0 }, -leafW / 2, leafW / 2, b0, b1, 0, DOOR_HEIGHT);
    leaf.frame(0, 0, 0, 0).box(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
  };
  leafFrame(-0.02, 0.02);

  const steelMat = new MeshStandardMaterial({ color: 0x2c3134, roughness: 0.4, metalness: 0.75 });
  const glassMat = new MeshStandardMaterial({
    color: 0xa9c3cf,
    roughness: 0.05,
    metalness: 0.2,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: DoubleSide,
  });
  const lightMat = new MeshStandardMaterial({ color: 0xfff3dd, emissive: 0xfff0d8, emissiveIntensity: 0.6 });
  for (const m of [steelMat, glassMat, lightMat]) ctx?.sun.setupMaterial(m);
  const geometries = [steel, glass, cabSteel, cabGlass, cabLight, leaf].map(b => b.build());
  const [steelGeo, glassGeo, cabSteelGeo, cabGlassGeo, cabLightGeo, leafGeo] = geometries;
  const mesh = (g: BufferGeometry, m: Material, shadow = true) => {
    const o = new Mesh(g, m);
    o.castShadow = shadow;
    o.receiveShadow = true;
    return o;
  };
  const still = new Group();
  still.add(mesh(steelGeo, steelMat), mesh(glassGeo, glassMat, false));
  const cab = new Group();
  cab.add(mesh(cabSteelGeo, steelMat), mesh(cabGlassGeo, glassMat, false), mesh(cabLightGeo, lightMat, false));

  const leaves: { mesh: Mesh; stop: LiftStop; side: number }[] = [];
  for (const stop of ['street', 'roof'] as const)
    for (const side of [-1, 1]) {
      const m = mesh(leafGeo, glassMat, false);
      still.add(m);
      leaves.push({ mesh: m, stop, side });
    }

  return {
    static: still,
    cab,
    place(y: number, open: number, stop: LiftStop | null) {
      cab.position.set(plan.x, y, plan.z);
      for (const l of leaves) {
        const b = l.stop === 'street' ? h + WALL / 2 : -h - WALL / 2;
        const ease = l.stop === stop ? open * open * (3 - 2 * open) : 0;
        const a = l.side * (leafW / 2 + ease * (leafW - 0.05));
        l.mesh.position.set(
          plan.x + plan.ux * a + plan.nx * b,
          l.stop === 'street' ? plan.streetY : plan.roofY,
          plan.z + plan.uz * a + plan.nz * b,
        );
      }
    },
    setNight(night: boolean) {
      lightMat.emissiveIntensity = night ? 6 : 0.6;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of [steelMat, glassMat, lightMat]) m.dispose();
    },
  };
}
