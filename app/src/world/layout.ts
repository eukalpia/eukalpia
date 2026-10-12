import type { District } from '../content/districts';
import { fork, int, mulberry32, range, shuffle, type Rng } from './rng';

export const DEFAULT_SEED = 20260905;

export type IslandId = 'main' | 'ne' | 'nw' | 'se' | 'sw';

export interface Island {
  id: IslandId;
  cx: number;
  cz: number;
  radius: number;
  topY: number;
  depth: number;
}

export interface Street {
  islandId: IslandId;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  width: number;
  kind: 'avenue' | 'street';
}

export interface Block {
  islandId: IslandId;
  /** Outer rectangle, from kerb to kerb. */
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface Lot {
  id: string;
  islandId: IslandId;
  x: number;
  z: number;
  width: number;
  depth: number;
  role: 'monolith' | 'landmark' | 'filler' | 'park';
  districtId?: number;
}

export interface Bridge {
  from: IslandId;
  to: IslandId;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  width: number;
}

export interface CityLayout {
  seed: number;
  islands: Island[];
  streets: Street[];
  blocks: Block[];
  lots: Lot[];
  bridges: Bridge[];
}

export const MAIN_RADIUS = 260;
export const SATELLITE_DISTANCE = 420;
/** Lots keep this distance from the island edge; the band in between is the rim promenade. */
export const RIM_MARGIN = 18;
export const SIDEWALK_WIDTH = 4;
export const LOT_SETBACK = 3;
export const MIN_LOT = 18;
const LOT_GAP = 1;
const CENTER_BLOCK = 90;
const MONOLITH_FOOTPRINT = 46;
const LANDMARK_MIN_SIDE = 24;
const LANDMARK_RING: [number, number] = [70, 210];
const BRIDGE_WIDTH = 12;

interface Interval {
  kind: 'block' | 'street';
  a: number;
  b: number;
  avenue?: boolean;
}

/** Lays out alternating streets and blocks along one axis, outwards from the island center. */
function partitionAxis(r: Rng, radius: number, center: 'block' | 'street'): Interval[] {
  const out: Interval[] = [];
  let first: Interval;
  if (center === 'block') first = { kind: 'block', a: -CENTER_BLOCK / 2, b: CENTER_BLOCK / 2 };
  else {
    const w = Math.round(range(r, 14, 18));
    first = { kind: 'street', a: -w / 2, b: w / 2 };
  }
  out.push(first);

  for (const sign of [1, -1]) {
    let edge = sign > 0 ? first.b : first.a;
    let nextKind: Interval['kind'] = first.kind === 'block' ? 'street' : 'block';
    // The ring road around the central plaza is an avenue; after that, every 2–3 blocks.
    let untilAvenue = center === 'block' ? 0 : int(r, 2, 3);
    while (Math.abs(edge) < radius) {
      let size: number;
      let avenue = false;
      if (nextKind === 'street') {
        avenue = untilAvenue <= 0;
        size = avenue ? 22 : Math.round(range(r, 14, 18));
        if (avenue) untilAvenue = int(r, 2, 3);
      } else {
        size = Math.round(range(r, 60, 90));
        untilAvenue -= 1;
      }
      const next = edge + sign * size;
      out.push({ kind: nextKind, a: Math.min(edge, next), b: Math.max(edge, next), avenue });
      edge = next;
      nextKind = nextKind === 'block' ? 'street' : 'block';
    }
  }
  return out.sort((p, q) => p.a - q.a);
}

/** Splits `length` into `n` parts of at least `min`, separated by `gap`. */
function splitLength(r: Rng, length: number, n: number, min: number, gap: number): [number, number][] {
  const free = length - gap * (n - 1) - min * n;
  const weights = Array.from({ length: n }, () => 0.4 + r());
  const total = weights.reduce((s, w) => s + w, 0);
  const parts: [number, number][] = [];
  let at = 0;
  for (let i = 0; i < n; i++) {
    const size = min + (free * weights[i]) / total;
    parts.push([at, at + size]);
    at += size + gap;
  }
  return parts;
}

export function lotCorners(lot: Pick<Lot, 'x' | 'z' | 'width' | 'depth'>): [number, number][] {
  const hw = lot.width / 2;
  const hd = lot.depth / 2;
  return [
    [lot.x - hw, lot.z - hd],
    [lot.x + hw, lot.z - hd],
    [lot.x + hw, lot.z + hd],
    [lot.x - hw, lot.z + hd],
  ];
}

function insideIsland(island: Island, lot: Pick<Lot, 'x' | 'z' | 'width' | 'depth'>): boolean {
  const limit = island.radius - RIM_MARGIN;
  return lotCorners(lot).every(([x, z]) => Math.hypot(x - island.cx, z - island.cz) <= limit);
}

/** Shrinks a lot away from the island edge until it fits, or returns null if it gets too small. */
function fitToIsland(island: Island, rect: { x: number; z: number; width: number; depth: number }) {
  const lot = { ...rect };
  for (let i = 0; i < 60 && !insideIsland(island, lot); i++) {
    const dx = lot.x - island.cx;
    const dz = lot.z - island.cz;
    const step = 1;
    if (Math.abs(dx) >= Math.abs(dz) || lot.depth <= MIN_LOT) {
      lot.width -= step;
      lot.x -= (Math.sign(dx) * step) / 2;
    } else {
      lot.depth -= step;
      lot.z -= (Math.sign(dz) * step) / 2;
    }
    if (lot.width < MIN_LOT || lot.depth < MIN_LOT) return null;
  }
  return insideIsland(island, lot) ? lot : null;
}

export function findOverlaps(lots: readonly Lot[]): [string, string][] {
  const overlaps: [string, string][] = [];
  for (let i = 0; i < lots.length; i++) {
    for (let j = i + 1; j < lots.length; j++) {
      const a = lots[i];
      const b = lots[j];
      const ox = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
      const oz = Math.min(a.z + a.depth / 2, b.z + b.depth / 2) - Math.max(a.z - a.depth / 2, b.z - b.depth / 2);
      if (ox > 1e-6 && oz > 1e-6) overlaps.push([a.id, b.id]);
    }
  }
  return overlaps;
}

export function groundY(layout: CityLayout, x: number, z: number): number {
  for (const island of layout.islands) {
    if (Math.hypot(x - island.cx, z - island.cz) <= island.radius) return island.topY;
  }
  return NaN;
}

function createIslands(r: Rng): Island[] {
  const islands: Island[] = [{ id: 'main', cx: 0, cz: 0, radius: MAIN_RADIUS, topY: 0, depth: 234 }];
  const bearings: [IslandId, number][] = [
    ['ne', 45],
    ['se', 135],
    ['sw', 225],
    ['nw', 315],
  ];
  for (const [id, bearing] of bearings) {
    const a = (bearing * Math.PI) / 180;
    const radius = Math.round(range(r, 100, 125));
    islands.push({
      id,
      cx: SATELLITE_DISTANCE * Math.sin(a),
      cz: -SATELLITE_DISTANCE * Math.cos(a),
      radius,
      topY: Math.round(range(r, -20, 25)),
      depth: radius * 0.95,
    });
  }
  return islands;
}

function layOutIsland(r: Rng, island: Island, streets: Street[], blocks: Block[], lots: Lot[]) {
  const center = island.id === 'main' ? 'block' : 'street';
  const xs = partitionAxis(fork(r, 1), island.radius, center);
  const zs = partitionAxis(fork(r, 2), island.radius, center);
  const reach = island.radius - 8;

  for (const [axis, intervals] of [
    ['x', xs],
    ['z', zs],
  ] as const) {
    for (const s of intervals) {
      if (s.kind !== 'street') continue;
      const offset = (s.a + s.b) / 2;
      if (Math.abs(offset) >= reach - 10) continue;
      const half = Math.sqrt(reach * reach - offset * offset);
      const street: Street = {
        islandId: island.id,
        ax: island.cx + (axis === 'x' ? offset : -half),
        az: island.cz + (axis === 'x' ? -half : offset),
        bx: island.cx + (axis === 'x' ? offset : half),
        bz: island.cz + (axis === 'x' ? half : offset),
        width: s.b - s.a,
        kind: s.avenue ? 'avenue' : 'street',
      };
      streets.push(street);
    }
  }

  const inset = SIDEWALK_WIDTH + LOT_SETBACK;
  const lotRng = fork(r, 3);
  let n = 0;
  for (const bx of xs) {
    if (bx.kind !== 'block') continue;
    for (const bz of zs) {
      if (bz.kind !== 'block') continue;
      const block: Block = {
        islandId: island.id,
        x: island.cx + (bx.a + bx.b) / 2,
        z: island.cz + (bz.a + bz.b) / 2,
        width: bx.b - bx.a,
        depth: bz.b - bz.a,
      };
      const nearest = Math.hypot(
        Math.max(Math.abs(block.x - island.cx) - block.width / 2, 0),
        Math.max(Math.abs(block.z - island.cz) - block.depth / 2, 0),
      );
      if (nearest > island.radius - RIM_MARGIN) continue;
      blocks.push(block);

      const innerW = block.width - inset * 2;
      const innerD = block.depth - inset * 2;
      const isCenter = island.id === 'main' && bx.a < 0 && bx.b > 0 && bz.a < 0 && bz.b > 0;
      if (isCenter) {
        lots.push({
          id: `${island.id}-monolith`,
          islandId: island.id,
          x: block.x,
          z: block.z,
          width: MONOLITH_FOOTPRINT,
          depth: MONOLITH_FOOTPRINT,
          role: 'monolith',
        });
        continue;
      }

      const alongX = innerW >= innerD;
      const long = alongX ? innerW : innerD;
      const short = alongX ? innerD : innerW;
      const maxN = Math.floor((long + LOT_GAP) / (MIN_LOT + LOT_GAP));
      const maxM = Math.floor((short + LOT_GAP) / (MIN_LOT + LOT_GAP));
      if (maxN < 1 || maxM < 1) continue;
      const nLong = Math.min(maxN, int(lotRng, 2, 3));
      const nShort = maxM >= 2 && lotRng() < 0.7 ? 2 : 1;
      const longParts = splitLength(lotRng, long, nLong, MIN_LOT, LOT_GAP);
      const shortParts = splitLength(lotRng, short, nShort, MIN_LOT, LOT_GAP);
      const x0 = block.x - innerW / 2;
      const z0 = block.z - innerD / 2;
      for (const [la, lb] of longParts) {
        for (const [sa, sb] of shortParts) {
          const rect = alongX
            ? { x: x0 + (la + lb) / 2, z: z0 + (sa + sb) / 2, width: lb - la, depth: sb - sa }
            : { x: x0 + (sa + sb) / 2, z: z0 + (la + lb) / 2, width: sb - sa, depth: lb - la };
          const fitted = fitToIsland(island, rect);
          if (!fitted) continue;
          lots.push({ id: `${island.id}-${n++}`, islandId: island.id, ...fitted, role: 'filler' });
        }
      }
    }
  }
}

function sectorOf(x: number, z: number): number {
  const angle = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
  return Math.floor(angle / ((Math.PI * 2) / 16)) % 16;
}

function assignLandmarks(r: Rng, lots: Lot[], districts: readonly District[]) {
  const order = [...districts].sort((a, b) => {
    const rank = (d: District) => (d.production ? 0 : d.research ? 1 : 2);
    return rank(a) - rank(b) || a.id - b.id;
  });
  const sectors = shuffle(
    r,
    Array.from({ length: 16 }, (_, i) => i),
  );
  const candidates = lots.filter(l => {
    const radius = Math.hypot(l.x, l.z);
    return (
      l.islandId === 'main' &&
      l.role === 'filler' &&
      radius >= LANDMARK_RING[0] &&
      radius <= LANDMARK_RING[1] &&
      Math.min(l.width, l.depth) >= LANDMARK_MIN_SIDE
    );
  });

  order.forEach((district, i) => {
    const preferred = (l: Lot) => {
      const radius = Math.hypot(l.x, l.z);
      return district.production ? radius <= 150 : radius >= 110;
    };
    const free = candidates.filter(l => l.role === 'filler');
    let chosen: Lot | undefined;
    for (let spread = 0; spread <= 8 && !chosen; spread++) {
      const inReach = free.filter(l => {
        const d = Math.abs(sectorOf(l.x, l.z) - sectors[i]);
        return Math.min(d, 16 - d) <= spread;
      });
      const pool = inReach.some(preferred) ? inReach.filter(preferred) : inReach;
      chosen = pool.sort((a, b) => b.width * b.depth - a.width * a.depth)[0];
    }
    if (!chosen) throw new Error(`No landmark lot left for ${district.name}`);
    chosen.role = 'landmark';
    chosen.districtId = district.id;
  });
}

function assignParks(r: Rng, lots: Lot[]) {
  const pool = lots.filter(l => l.role === 'filler' && Math.hypot(l.x, l.z) > 90);
  for (const lot of shuffle(r, pool).slice(0, 6)) lot.role = 'park';
}

function createBridges(islands: Island[]): Bridge[] {
  const main = islands[0];
  return islands.slice(1).map(sat => {
    const d = Math.hypot(sat.cx, sat.cz);
    const ux = sat.cx / d;
    const uz = sat.cz / d;
    return {
      from: main.id,
      to: sat.id,
      ax: ux * (main.radius - 6),
      ay: main.topY,
      az: uz * (main.radius - 6),
      bx: sat.cx - ux * (sat.radius - 6),
      by: sat.topY,
      bz: sat.cz - uz * (sat.radius - 6),
      width: BRIDGE_WIDTH,
    };
  });
}

export function createLayout(seed: number, districts: readonly District[]): CityLayout {
  const root = mulberry32(seed);
  const islands = createIslands(fork(root, 10));
  const streets: Street[] = [];
  const blocks: Block[] = [];
  const lots: Lot[] = [];
  islands.forEach((island, i) => layOutIsland(fork(root, 100 + i), island, streets, blocks, lots));
  assignLandmarks(fork(root, 20), lots, districts);
  assignParks(fork(root, 30), lots);
  return { seed, islands, streets, blocks, lots, bridges: createBridges(islands) };
}
