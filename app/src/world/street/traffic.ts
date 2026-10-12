import {
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { SunRig } from '../../engine/lighting/sun';
import { TIER_SETTINGS, type QualityTier } from '../../engine/quality';
import { MeshBuilder } from '../buildings/geometry';
import type { BuildingSpec } from '../buildings/massing';
import type { CityLayout, Street } from '../layout';
import { mulberry32, range, int, type Rng } from '../rng';
import { streetRect } from '../ground/groundMask';
import { signalState, type Crossing } from './clutter';
import { CAR_COLORS, type StreetMeshes } from './meshes';

export interface Route {
  street: Street;
  /** Start position along the out-and-back loop, in meters. */
  offset: number;
  speed: number;
  color: number;
}

const MIN_GAP = 12;

function length(s: Street) {
  return Math.hypot(s.bx - s.ax, s.bz - s.az);
}

/** The asphalt ends this far inside the rim (the promenade beyond is paving). */
const PROMENADE = 14;
/** Room a car needs before a crossing to stop, plus its own length. */
const CROSSING_CLEARANCE = 12;

/**
 * The drivable part of a street: on the asphalt, and ending before any crossing too close to the end
 * to stop for, so cars turn around before a junction rather than inside one.
 */
export function drivable(street: Street, layout: CityLayout): Street {
  const island = layout.islands.find(i => i.id === street.islandId)!;
  const len = length(street);
  const ux = (street.bx - street.ax) / len;
  const uz = (street.bz - street.az) / len;
  // Distance along the street from its centre point (the closest approach to the island centre).
  const mx = (street.ax + street.bx) / 2;
  const mz = (street.az + street.bz) / 2;
  const off = Math.hypot(mx - island.cx, mz - island.cz) + street.width / 2;
  const asphalt = island.radius - PROMENADE - 1;
  let half = Math.min(len / 2, off < asphalt ? Math.sqrt(asphalt * asphalt - off * off) : 0);
  for (const o of layout.streets) {
    if (o.islandId !== street.islandId || o === street) continue;
    const r = streetRect(o);
    const vertical = Math.abs(street.ax - street.bx) < 1e-6;
    if (r.vertical === vertical) continue;
    const along = Math.abs(vertical ? r.center - mz : r.center - mx);
    const near = along - o.width / 2 - CROSSING_CLEARANCE;
    const far = along + o.width / 2;
    // A crossing reaching past the asphalt end: stop the street short of it.
    if (far > half && near < half) half = Math.max(0, near);
  }
  return {
    ...street,
    ax: mx - ux * half,
    az: mz - uz * half,
    bx: mx + ux * half,
    bz: mz + uz * half,
  };
}

/** Cars spread over the streets in proportion to their length, evenly spaced, one speed per street. */
export function planTraffic(layout: CityLayout, count: number): Route[] {
  const rng = mulberry32(layout.seed ^ 0x7aff1c);
  const streets = layout.streets.map(s => drivable(s, layout)).filter(s => length(s) > 40);
  const total = streets.reduce((sum, s) => sum + length(s), 0);
  const capacity = streets.map(s => Math.floor((2 * length(s)) / MIN_GAP));
  const wanted = streets.map((s, i) => Math.min(capacity[i], Math.round((count * length(s)) / total)));
  // Top up or trim so the total is exactly `count`.
  let diff = count - wanted.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0 && i < streets.length * 4; i++) {
    const k = i % streets.length;
    if (diff > 0 && wanted[k] < capacity[k]) (wanted[k]++, diff--);
    else if (diff < 0 && wanted[k] > 0) (wanted[k]--, diff++);
  }
  const routes: Route[] = [];
  streets.forEach((street, i) => {
    const n = wanted[i];
    if (n === 0) return;
    const loop = 2 * length(street);
    const spacing = loop / n;
    const speed = range(rng, 8, 14);
    const start = rng() * loop;
    for (let k = 0; k < n; k++) {
      routes.push({
        street,
        offset: (start + k * spacing + range(rng, -0.12, 0.12) * Math.max(0, spacing - MIN_GAP)) % loop,
        speed,
        color: CAR_COLORS[int(rng, 0, CAR_COLORS.length - 1)],
      });
    }
  });
  return routes;
}

/** Position and heading of a car at time t: out along the right-hand lane, back along the other. */
export function carPose(route: Route, t: number): { x: number; z: number; rotY: number } {
  return poseOnLoop(route.street, route.offset + route.speed * t);
}

/** Pose at loop distance d: 0..length out along the street, length..2·length back on the other lane. */
export function poseOnLoop(s: Street, distance: number): { x: number; z: number; rotY: number } {
  const len = length(s);
  const loop = 2 * len;
  let d = distance % loop;
  if (d < 0) d += loop;
  const out = d < len;
  const along = out ? d : loop - d;
  const ux = (s.bx - s.ax) / len;
  const uz = (s.bz - s.az) / len;
  // Direction of travel and the right-hand lane offset (right = forward × up = (−dz, dx)).
  const dx = out ? ux : -ux;
  const dz = out ? uz : -uz;
  const lane = s.width / 4;
  return {
    x: s.ax + ux * along - dz * lane,
    z: s.az + uz * along + dx * lane,
    rotY: Math.atan2(-dz, dx),
  };
}

/** Half a car's length: the body runs ±2.25 m about its origin. */
export const CAR_HALF = 2.25;
/** Stop lines sit this far before the cross street's kerb, behind the zebra crossing. */
const STOP_BEFORE = 4.6;
const ACCEL = 1.6;
const COMFORT_BRAKE = 2.5;
const HARD_BRAKE = 9;
/** Deceleration a driver accepts to stop for an amber light rather than go through. */
const AMBER_BRAKE = 5;
const HEADWAY = 1.2;
const STANDSTILL_GAP = 2;
const LINE_GAP = 0.3;
const LOOK_AHEAD = 70;
const WARM_UP = 30;

export interface StopLine {
  /** Loop distance where a car's front bumper must stop. */
  at: number;
  crossing: number;
  axis: 'ns' | 'ew';
}

export interface SimCar {
  route: Route;
  length: number;
  /** Loop distance of the car's centre. */
  d: number;
  v: number;
  braking: boolean;
}

export interface TrafficSim {
  cars: SimCar[];
  step(dt: number, t: number): void;
  stopLines(car: SimCar): StopLine[];
  streets(): SimCar[][];
}

/** Stop lines on both lanes of a street, one before each crossing, in loop distance order. */
export function stopLinesFor(s: Street, crossings: readonly Crossing[]): StopLine[] {
  const len = length(s);
  const loop = 2 * len;
  const ux = (s.bx - s.ax) / len;
  const uz = (s.bz - s.az) / len;
  const vertical = Math.abs(s.ax - s.bx) < 1e-6;
  const lines: StopLine[] = [];
  crossings.forEach((c, i) => {
    if (c.islandId !== s.islandId) return;
    const along = (c.x - s.ax) * ux + (c.z - s.az) * uz;
    const off = Math.abs((c.x - s.ax) * uz - (c.z - s.az) * ux);
    if (off > 1e-3 || along < 0 || along > len) return;
    const cross = (vertical ? c.wz : c.wx) / 2 + STOP_BEFORE;
    const axis = vertical ? 'ns' : 'ew';
    if (along - cross > 0) lines.push({ at: along - cross, crossing: i, axis });
    if (along + cross < len) lines.push({ at: loop - (along + cross), crossing: i, axis });
  });
  return lines.sort((a, b) => a.at - b.at);
}

/**
 * Car following (intelligent driver model) along each street's out-and-back loop, with every car
 * stopping for red, and for amber when it can stop comfortably. Warmed up so queues exist at t = 0.
 */
export function createTrafficSim(routes: readonly Route[], crossings: readonly Crossing[]): TrafficSim {
  const groups = new Map<Street, SimCar[]>();
  const lines = new Map<Street, StopLine[]>();
  const cars: SimCar[] = routes.map(route => {
    const car = { route, length: length(route.street), d: route.offset, v: 0, braking: false };
    if (!groups.has(route.street)) {
      groups.set(route.street, []);
      lines.set(route.street, stopLinesFor(route.street, crossings));
    }
    groups.get(route.street)!.push(car);
    return car;
  });
  const accel = new Float32Array(cars.length);
  const index = new Map(cars.map((c, i) => [c, i]));
  const interaction = (s: number, v: number, dv: number, gap: number) => {
    const want = gap + v * HEADWAY + (v * dv) / (2 * Math.sqrt(ACCEL * COMFORT_BRAKE));
    const r = Math.max(0, want) / Math.max(s, 0.05);
    return r * r;
  };

  function step(dt: number, t: number) {
    for (const [street, group] of groups) {
      group.sort((a, b) => a.d - b.d);
      const loop = 2 * length(street);
      const stops = lines.get(street)!;
      group.forEach((car, i) => {
        const v = car.v;
        const v0 = car.route.speed;
        let brake = 0;
        if (group.length > 1) {
          const lead = group[(i + 1) % group.length];
          const gap = ((lead.d - car.d + loop) % loop) - 2 * CAR_HALF;
          brake = Math.max(brake, interaction(gap, v, v - lead.v, STANDSTILL_GAP));
        }
        const front = (car.d + CAR_HALF) % loop;
        let next: StopLine | undefined;
        let rel = Infinity;
        for (const line of stops) {
          const r = (line.at - front + loop) % loop;
          if (r < rel) ((rel = r), (next = line));
        }
        if (next && rel < LOOK_AHEAD) {
          const light = signalState(crossings[next.crossing], t)[next.axis];
          const canStop = rel > (v * v) / (2 * AMBER_BRAKE);
          if (light === 'red' || (light === 'amber' && canStop))
            brake = Math.max(brake, interaction(rel, v, v, LINE_GAP));
        }
        const a = ACCEL * (1 - Math.pow(v / v0, 4) - brake);
        accel[index.get(car)!] = Math.max(-HARD_BRAKE, Math.min(ACCEL, a));
      });
    }
    cars.forEach((car, i) => {
      const loop = 2 * car.length;
      const v = Math.max(0, car.v + accel[i] * dt);
      car.d = (car.d + ((car.v + v) / 2) * dt) % loop;
      car.v = v;
      car.braking = accel[i] < -0.6 || v < 0.3;
    });
  }

  for (let t = -WARM_UP; t < 0; t += 1 / 20) step(1 / 20, t);
  return {
    cars,
    step,
    stopLines: car => lines.get(car.route.street)!,
    streets: () => [...groups.values()],
  };
}

export interface Skyway {
  radius: number;
  height: number;
  /** m/s along the loop; negative flies clockwise. */
  speed: number;
  phases: number[];
}

/** Six circular skyways around the centre, each checked against every tower and its crown. */
export function planSkyways(seed: number, specs: readonly BuildingSpec[]): Skyway[] {
  const rng: Rng = mulberry32(seed ^ 0x5ca1ab);
  const ways: Skyway[] = [];
  for (let attempt = 0; ways.length < 6 && attempt < 4000; attempt++) {
    const radius = range(rng, 170, 560);
    const height = range(rng, 70, 190 + attempt * 0.05);
    const way: Skyway = {
      radius,
      height,
      speed: range(rng, 18, 30) * (rng() < 0.5 ? -1 : 1),
      phases: Array.from({ length: int(rng, 4, 8) }, () => rng() * Math.PI * 2),
    };
    if (
      clearOfTowers(way, specs) &&
      ways.every(w => Math.abs(w.height - height) > 8 || Math.abs(w.radius - radius) > 25)
    )
      ways.push(way);
  }
  return ways;
}

function clearOfTowers(way: Skyway, specs: readonly BuildingSpec[]): boolean {
  for (let k = 0; k < 720; k++) {
    const a = (k / 720) * Math.PI * 2;
    const p = pointOn(way, a);
    for (const s of specs) {
      const crown = s.crown === 'flat' ? 0 : 45;
      for (const t of s.tiers) {
        if (
          Math.abs(p.x - t.cx) < t.width / 2 + 16 &&
          Math.abs(p.z - t.cz) < t.depth / 2 + 16 &&
          p.y <= t.y1 + 16 + crown
        )
          return false;
      }
    }
  }
  return true;
}

function pointOn(way: Skyway, angle: number) {
  return {
    x: Math.cos(angle) * way.radius,
    // Gentle undulation so the loops don't look like rails.
    y: way.height + Math.sin(angle * 3) * 4,
    z: Math.sin(angle) * way.radius,
  };
}

export function podPose(way: Skyway, index: number, t: number): { x: number; y: number; z: number; rotY: number } {
  const angle = way.phases[index % way.phases.length] + (way.speed / way.radius) * t;
  const p = pointOn(way, angle);
  // Tangent direction of travel.
  const dir = Math.sign(way.speed) || 1;
  const tx = -Math.sin(angle) * dir;
  const tz = Math.cos(angle) * dir;
  return { ...p, rotY: Math.atan2(-tz, tx) };
}

export interface Traffic {
  group: Group;
  /** Advances cars by dt; t is the shared street clock the signals run on. */
  update(dt: number, t: number): void;
  setNight(night: boolean): void;
  dispose(): void;
}

function lightsGeometry(front: boolean): BufferGeometry {
  const b = new MeshBuilder();
  const x = front ? 2.2 : -2.2;
  const d = front ? 0.04 : -0.04;
  for (const z of [-0.7, 0.7]) b.box(Math.min(x, x + d), 0.68, z - 0.16, Math.max(x, x + d), 0.82, z + 0.16, true);
  return b.build();
}

export function createTraffic(
  layout: CityLayout,
  specs: readonly BuildingSpec[],
  street: StreetMeshes,
  ctx: { sun: SunRig; cars: number; crossings: readonly Crossing[]; tier: QualityTier },
): Traffic {
  const group = new Group();
  group.name = 'Traffic';
  const routes = planTraffic(layout, ctx.cars);
  const sim = createTrafficSim(routes, ctx.crossings);
  const ways = planSkyways(layout.seed, specs);
  const islandY = (r: Route) => layout.islands.find(i => i.id === r.street.islandId)!.topY;

  const { body, glass, wheels } = street.carGeometry;
  const mats = street.carMaterials;
  const bodies = new InstancedMesh(body, mats.body, routes.length);
  const glasses = new InstancedMesh(glass, mats.glass, routes.length);
  const tyres = new InstancedMesh(wheels, mats.wheels, routes.length);
  const headGeo = lightsGeometry(true);
  const tailGeo = lightsGeometry(false);
  const headMat = new MeshStandardMaterial({
    color: 0xdddddd,
    emissive: 0xfff4e0,
    emissiveIntensity: 0,
    roughness: 0.2,
  });
  // Tail lights are unlit colour per instance so brake lights can flare car by car.
  const tailMat = new MeshBasicMaterial({ color: 0xffffff });
  const heads = new InstancedMesh(headGeo, headMat, routes.length);
  const tails = new InstancedMesh(tailGeo, tailMat, routes.length);
  const color = new Color();
  routes.forEach((r, i) => bodies.setColorAt(i, color.set(r.color)));
  const casts = TIER_SETTINGS[ctx.tier].shadowCasters.has('vehicle');
  for (const m of [bodies, glasses, tyres]) {
    m.castShadow = casts;
    m.receiveShadow = true;
  }
  group.add(bodies, glasses, tyres, heads, tails);

  const podCount = ways.reduce((n, w) => n + w.phases.length, 0);
  const podGeo = new CapsuleGeometry(1.1, 4.2, 6, 12).rotateZ(Math.PI / 2);
  const podMat = new MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.25, metalness: 0.6 });
  ctx.sun.setupMaterial(podMat);
  const pods = new InstancedMesh(podGeo, podMat, podCount);
  pods.castShadow = casts;
  const stripGeo = new MeshBuilder();
  stripGeo.box(-2.4, -0.12, -1.12, 2.4, 0.12, 1.12, true);
  const strip = stripGeo.build();
  const stripMat = new MeshStandardMaterial({ color: 0x0a1418, emissive: 0x63e6ff, emissiveIntensity: 0.6 });
  const strips = new InstancedMesh(strip, stripMat, podCount);
  group.add(pods, strips);

  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const one = new Vector3(1, 1, 1);
  let t = 0;
  let night = false;
  const tailColor = new Color();
  function place() {
    sim.cars.forEach((car, i) => {
      const r = car.route;
      const pose = poseOnLoop(r.street, car.d);
      m.compose(p.set(pose.x, islandY(r), pose.z), q.setFromAxisAngle(up, pose.rotY), one);
      const glow = car.braking ? (night ? 9 : 4) : night ? 2.2 : 0.08;
      tails.setColorAt(i, tailColor.setRGB(glow, glow * 0.04, glow * 0.025));
      bodies.setMatrixAt(i, m);
      glasses.setMatrixAt(i, m);
      tyres.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      tails.setMatrixAt(i, m);
    });
    let k = 0;
    for (const w of ways)
      for (let i = 0; i < w.phases.length; i++, k++) {
        const pose = podPose(w, i, t);
        m.compose(p.set(pose.x, pose.y, pose.z), q.setFromAxisAngle(up, pose.rotY), one);
        pods.setMatrixAt(k, m);
        strips.setMatrixAt(k, m);
      }
    if (tails.instanceColor) tails.instanceColor.needsUpdate = true;
    for (const mesh of [bodies, glasses, tyres, heads, tails, pods, strips]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
  place();

  return {
    group,
    update(dt, clock) {
      t += dt;
      sim.step(dt, clock);
      place();
    },
    setNight(isNight) {
      night = isNight;
      headMat.emissiveIntensity = night ? 12 : 0;
      stripMat.emissiveIntensity = night ? 5 : 0.6;
      place();
    },
    dispose() {
      for (const g of [headGeo, tailGeo, podGeo, strip]) g.dispose();
      for (const mat of [headMat, tailMat, podMat, stripMat]) mat.dispose();
    },
  };
}
