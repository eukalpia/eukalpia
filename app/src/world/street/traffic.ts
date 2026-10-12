import {
  CapsuleGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { SunRig } from '../../engine/lighting/sun';
import { MeshBuilder } from '../buildings/geometry';
import type { BuildingSpec } from '../buildings/massing';
import type { CityLayout, Street } from '../layout';
import { mulberry32, range, int, type Rng } from '../rng';
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

/** Cars spread over the streets in proportion to their length, evenly spaced, one speed per street. */
export function planTraffic(layout: CityLayout, count: number): Route[] {
  const rng = mulberry32(layout.seed ^ 0x7aff1c);
  const streets = layout.streets.filter(s => length(s) > 40);
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
  const s = route.street;
  const len = length(s);
  const loop = 2 * len;
  let d = (route.offset + route.speed * t) % loop;
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
  update(dt: number): void;
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
  ctx: { sun: SunRig; cars: number },
): Traffic {
  const group = new Group();
  group.name = 'Traffic';
  const routes = planTraffic(layout, ctx.cars);
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
  const tailMat = new MeshStandardMaterial({
    color: 0x400000,
    emissive: 0xff1a12,
    emissiveIntensity: 0,
    roughness: 0.3,
  });
  const heads = new InstancedMesh(headGeo, headMat, routes.length);
  const tails = new InstancedMesh(tailGeo, tailMat, routes.length);
  const color = new Color();
  routes.forEach((r, i) => bodies.setColorAt(i, color.set(r.color)));
  for (const m of [bodies, glasses, tyres]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  group.add(bodies, glasses, tyres, heads, tails);

  const podCount = ways.reduce((n, w) => n + w.phases.length, 0);
  const podGeo = new CapsuleGeometry(1.1, 4.2, 6, 12).rotateZ(Math.PI / 2);
  const podMat = new MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.25, metalness: 0.6 });
  ctx.sun.setupMaterial(podMat);
  const pods = new InstancedMesh(podGeo, podMat, podCount);
  pods.castShadow = true;
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
  function place() {
    routes.forEach((r, i) => {
      const pose = carPose(r, t);
      m.compose(p.set(pose.x, islandY(r), pose.z), q.setFromAxisAngle(up, pose.rotY), one);
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
    for (const mesh of [bodies, glasses, tyres, heads, tails, pods, strips]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }
  place();

  return {
    group,
    update(dt) {
      t += dt;
      place();
    },
    setNight(night) {
      headMat.emissiveIntensity = night ? 12 : 0;
      tailMat.emissiveIntensity = night ? 6 : 0;
      stripMat.emissiveIntensity = night ? 5 : 0.6;
    },
    dispose() {
      for (const g of [headGeo, tailGeo, podGeo, strip]) g.dispose();
      for (const mat of [headMat, tailMat, podMat, stripMat]) mat.dispose();
    },
  };
}
