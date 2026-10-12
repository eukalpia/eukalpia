import { BoxGeometry, BufferGeometry, CircleGeometry, Ray, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import type { BuildingSpec } from './buildings/massing';
import type { CityLayout } from './layout';
import type { FurniturePlan } from './street/furniture';

export interface CollisionIsland {
  cx: number;
  cz: number;
  radius: number;
  topY: number;
}

export interface CollisionWorld {
  bvh: MeshBVH;
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
  const hit = (o: Vector3, d: Vector3, far: number) => {
    ray.origin.copy(o);
    ray.direction.copy(d);
    const h = bvh.raycastFirst(ray, 2 /* DoubleSide */, 0, far);
    return h ? h.distance : null;
  };
  return {
    bvh,
    geometry,
    islands,
    groundAt(x, z, fromY) {
      const d = hit(origin.set(x, fromY, z), down, 2000);
      return d === null ? null : fromY - d;
    },
    raycast(o, d, far) {
      return hit(o, d, far);
    },
  };
}

function solidBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
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
    for (const t of spec.tiers)
      parts.push(solidBox(t.cx - t.width / 2, t.y0, t.cz - t.depth / 2, t.cx + t.width / 2, t.y1, t.cz + t.depth / 2));
  for (const b of layout.bridges) {
    // Deck as a chain of sloped slabs with walls on both sides.
    const steps = 24;
    const dx = b.bx - b.ax;
    const dz = b.bz - b.az;
    const len = Math.hypot(dx, dz);
    const sx = (-dz / len) * (b.width / 2);
    const sz = (dx / len) * (b.width / 2);
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const y = (t: number) => b.ay + (b.by - b.ay) * t + Math.sin(Math.PI * t) * 3;
      const ax = b.ax + dx * t0;
      const az = b.az + dz * t0;
      const cx = b.ax + dx * t1;
      const cz = b.az + dz * t1;
      const deck = wall(ax, az, cx, cz, Math.min(y(t0), y(t1)) - 1.4, Math.abs(y(t1) - y(t0)) + 1.4, b.width);
      parts.push(deck);
      for (const s of [-1, 1])
        parts.push(
          wall(
            ax + sx * s,
            az + sz * s,
            cx + sx * s,
            cz + sz * s,
            Math.min(y(t0), y(t1)),
            1.1 + Math.abs(y(t1) - y(t0)),
            0.2,
          ),
        );
    }
  }
  for (const r of furniture.railings) parts.push(wall(r.ax, r.az, r.bx, r.bz, r.y, 1.1, 0.12));
  for (const p of [...furniture.lamps, ...furniture.trees])
    parts.push(solidBox(p.x - 0.15, p.y, p.z - 0.15, p.x + 0.15, p.y + 3, p.z + 0.15));
  for (const c of furniture.parkedCars) {
    const along = Math.abs(Math.cos(c.rotY)) > 0.5;
    const hx = along ? 2.2 : 0.92;
    const hz = along ? 0.92 : 2.2;
    parts.push(solidBox(c.x - hx, c.y, c.z - hz, c.x + hx, c.y + 1.45, c.z + hz));
  }
  const geometry = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return createCollisionWorld(
    geometry,
    layout.islands.map(i => ({ cx: i.cx, cz: i.cz, radius: i.radius, topY: i.topY })),
  );
}
