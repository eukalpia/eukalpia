import { BoxGeometry, BufferGeometry, CircleGeometry, Ray, Vector3, type Box3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import type { BuildingSpec } from './buildings/massing';
import { bridgeDeckY } from './islands/bridge';
import type { CityLayout } from './layout';
import type { FurniturePlan } from './street/furniture';

export interface CollisionIsland {
  cx: number;
  cz: number;
  radius: number;
  topY: number;
}

/** Things that move or switch on and off (a lift platform, its doors); re-read on every query. */
export interface Mover {
  /** Walls: the capsule is pushed out of them sideways. */
  solids(): readonly Box3[];
  /** Floors: stood on, never pushed against; a query starting inside one finds its top. */
  floors(): readonly Box3[];
}

export interface CollisionWorld {
  bvh: MeshBVH;
  movers: Mover[];
  geometry: BufferGeometry;
  islands: readonly CollisionIsland[];
  /** Height of the first surface below (x, fromY, z), or null over the void. */
  groundAt(x: number, z: number, fromY: number): number | null;
  /** Distance to the first surface along a ray, or null. */
  raycast(origin: Vector3, dir: Vector3, far: number): number | null;
}

const ray = new Ray();

export function createCollisionWorld(geometry: BufferGeometry, islands: readonly CollisionIsland[]): CollisionWorld {
  const bvh = new MeshBVH(geometry, { maxLeafSize: 8 });
  const down = new Vector3(0, -1, 0);
  const origin = new Vector3();
  const movers: Mover[] = [];
  const boxHit = new Vector3();
  const hit = (o: Vector3, d: Vector3, far: number) => {
    ray.origin.copy(o);
    ray.direction.copy(d);
    const h = bvh.raycastFirst(ray, 2 /* DoubleSide */, 0, far);
    let best = h ? h.distance : Infinity;
    for (const m of movers)
      for (const b of [...m.solids(), ...m.floors()]) {
        if (b.containsPoint(o)) continue;
        if (ray.intersectBox(b, boxHit)) best = Math.min(best, boxHit.distanceTo(o));
      }
    return best <= far ? best : null;
  };
  return {
    bvh,
    movers,
    geometry,
    islands,
    groundAt(x, z, fromY) {
      const d = hit(origin.set(x, fromY, z), down, 2000);
      let ground = d === null ? null : fromY - d;
      for (const m of movers)
        for (const b of m.floors())
          if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z && b.min.y <= fromY)
            ground = Math.max(ground ?? -Infinity, Math.min(b.max.y, fromY));
      return ground;
    },
    raycast(o, d, far) {
      return hit(o, d, far);
    },
  };
}

export function solidBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g.toNonIndexed();
}

const PARAPET = 1.1;
const PARAPET_THICK = 0.3;
/** Taller than the highest jump plus the step offset, so nobody hops over an edge into the void. */
const EDGE_WALL = 3.2;

/** A slab whose top runs straight from (ax, ay, az) to (bx, by, bz): a ramp, not a stair. */
function slab(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, thick: number) {
  const run = Math.hypot(bx - ax, bz - az);
  const g = new BoxGeometry(Math.hypot(run, by - ay), thick, width);
  g.translate(0, -thick / 2, 0);
  g.rotateZ(Math.atan2(by - ay, run));
  g.rotateY(-Math.atan2(bz - az, bx - ax));
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g.toNonIndexed();
}

/** Thin wall from a to b on the ground, `height` tall. */
function wall(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  y: number,
  height: number,
  thick: number,
): BufferGeometry {
  const len = Math.hypot(bx - ax, bz - az);
  const g = new BoxGeometry(len, height, thick);
  g.rotateY(-Math.atan2(bz - az, bx - ax));
  g.translate((ax + bx) / 2, y + height / 2, (az + bz) / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g.toNonIndexed();
}

/** Static colliders for the whole city: ground discs, buildings, bridges, railings and street objects. */
export function buildCollisionWorld(
  layout: CityLayout,
  specs: readonly BuildingSpec[],
  furniture: FurniturePlan,
  posts: readonly { x: number; y: number; z: number }[] = [],
  extra: readonly BufferGeometry[] = [],
): CollisionWorld {
  const parts: BufferGeometry[] = [];
  for (const island of layout.islands) {
    const disc = new CircleGeometry(island.radius, 96)
      .rotateX(-Math.PI / 2)
      .translate(island.cx, island.topY, island.cz);
    disc.deleteAttribute('uv');
    disc.deleteAttribute('normal');
    parts.push(disc.toNonIndexed());
  }
  for (const spec of specs)
    for (const t of spec.tiers) {
      const x0 = t.cx - t.width / 2;
      const x1 = t.cx + t.width / 2;
      const z0 = t.cz - t.depth / 2;
      const z1 = t.cz + t.depth / 2;
      parts.push(solidBox(x0, t.y0, z0, x1, t.y1, z1));
      // The roof parapet, as high as the one drawn.
      const top = t.y1 + PARAPET;
      parts.push(
        solidBox(x0, t.y1, z0, x1, top, z0 + PARAPET_THICK),
        solidBox(x0, t.y1, z1 - PARAPET_THICK, x1, top, z1),
        solidBox(x0, t.y1, z0, x0 + PARAPET_THICK, top, z1),
        solidBox(x1 - PARAPET_THICK, t.y1, z0, x1, top, z1),
      );
    }
  for (const b of layout.bridges) {
    // Deck as a chain of sloped slabs following the arch, with tall walls on both sides.
    const steps = 24;
    const dx = b.bx - b.ax;
    const dz = b.bz - b.az;
    const len = Math.hypot(dx, dz);
    const sx = (-dz / len) * (b.width / 2);
    const sz = (dx / len) * (b.width / 2);
    const y = (t: number) => bridgeDeckY(b, t);
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const ax = b.ax + dx * t0;
      const az = b.az + dz * t0;
      const cx = b.ax + dx * t1;
      const cz = b.az + dz * t1;
      parts.push(slab(ax, y(t0), az, cx, y(t1), cz, b.width, 1.4));
      for (const s of [-1, 1])
        parts.push(
          wall(
            ax + sx * s,
            az + sz * s,
            cx + sx * s,
            cz + sz * s,
            Math.min(y(t0), y(t1)),
            EDGE_WALL + Math.abs(y(t1) - y(t0)),
            0.2,
          ),
        );
    }
  }
  // Rim railings are drawn 1.1 m high, but their colliders rise out of jumping reach: beyond is the void.
  for (const r of furniture.railings) parts.push(wall(r.ax, r.az, r.bx, r.bz, r.y, EDGE_WALL, 0.12));
  for (const p of [...furniture.lamps, ...furniture.trees])
    parts.push(solidBox(p.x - 0.15, p.y, p.z - 0.15, p.x + 0.15, p.y + 3, p.z + 0.15));
  for (const p of posts) parts.push(solidBox(p.x - 0.1, p.y, p.z - 0.1, p.x + 0.1, p.y + 3.4, p.z + 0.1));
  for (const c of furniture.parkedCars) {
    const along = Math.abs(Math.cos(c.rotY)) > 0.5;
    const hx = along ? 2.2 : 0.92;
    const hz = along ? 0.92 : 2.2;
    parts.push(solidBox(c.x - hx, c.y, c.z - hz, c.x + hx, c.y + 1.45, c.z + hz));
  }
  parts.push(...extra.map(g => (g.index ? g.toNonIndexed() : g.clone())));
  const geometry = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return createCollisionWorld(
    geometry,
    layout.islands.map(i => ({ cx: i.cx, cz: i.cz, radius: i.radius, topY: i.topY })),
  );
}
