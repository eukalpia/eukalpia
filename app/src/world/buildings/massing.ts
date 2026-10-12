import type { Lot } from '../layout';
import { pick, range, type Rng } from '../rng';
import { STYLES, type StyleId } from './styles';

export interface Tier {
  cx: number;
  cz: number;
  width: number;
  depth: number;
  y0: number;
  y1: number;
}

export type Crown = 'flat' | 'stepped' | 'spire' | 'mast';

export interface BuildingSpec {
  lotId: string;
  style: StyleId;
  floorHeight: number;
  bayWidth: number;
  tiers: Tier[];
  crown: Crown;
  seed: number;
  districtId?: number;
  baseY: number;
}

const MIN_TIER_SIDE = 10;

/** Style mix by distance from the city center: towers downtown, brick works at the edge. */
function chooseStyle(lot: Lot, rng: Rng): StyleId {
  const r = Math.hypot(lot.x, lot.z);
  const t = rng();
  if (lot.islandId !== 'main' || r > 200) return t < 0.35 ? 'industrial' : t < 0.8 ? 'modernist' : 'artdeco';
  if (r > 120) return t < 0.4 ? 'modernist' : t < 0.65 ? 'artdeco' : t < 0.85 ? 'glass' : 'industrial';
  return t < 0.4 ? 'artdeco' : t < 0.8 ? 'glass' : 'modernist';
}

/** Taller near the center of the main island; low-rise on satellites. */
function heightBias(lot: Lot): number {
  if (lot.islandId !== 'main') return 0.35;
  const r = Math.hypot(lot.x, lot.z);
  return Math.max(0.25, 1 - r / 260);
}

function floorsBetween(min: number, max: number, floorHeight: number): [number, number] {
  return [Math.ceil(min / floorHeight - 1e-9), Math.floor(max / floorHeight + 1e-9)];
}

export interface MassingOptions {
  style?: StyleId;
  /** Total height in meters before snapping to whole floors. */
  height?: number;
  /** Fractions of total height where setbacks happen, e.g. [0.4, 0.75]. */
  setbackAt?: number[];
  crown?: Crown;
  districtId?: number;
  /** Bypass the style's height range (landmarks and the monolith). */
  freeHeight?: boolean;
  floorHeight?: number;
}

/** Stacks tiers on a lot. Every tier sits inside the one below and ends on a whole floor. */
export function massBuilding(lot: Lot, baseY: number, rng: Rng, o: MassingOptions = {}): BuildingSpec {
  const style = o.style ?? chooseStyle(lot, rng);
  const def = STYLES[style];
  const floorHeight = o.floorHeight ?? Math.round(range(rng, ...def.floorHeight) * 100) / 100;
  const bayWidth = Math.round(range(rng, ...def.bayWidth) * 100) / 100;

  let floors: number;
  if (o.height !== undefined) {
    floors = Math.round(o.height / floorHeight);
  } else {
    const [minF, maxF] = floorsBetween(def.height[0], def.height[1], floorHeight);
    const f = Math.pow(rng(), 1.4) * heightBias(lot);
    floors = Math.round(minF + (maxF - minF) * f);
  }
  if (!o.freeHeight) {
    const [minF, maxF] = floorsBetween(def.height[0], def.height[1], floorHeight);
    floors = Math.min(maxF, Math.max(minF, floors));
  }
  floors = Math.max(1, floors);

  let cuts: number[] = [];
  if (o.setbackAt) cuts = o.setbackAt;
  else if (def.setbacks && floors * floorHeight > 60) {
    const first = range(rng, 0.3, 0.45);
    cuts = rng() < 0.55 ? [first, first + range(rng, 0.25, 0.35)] : [first];
  }
  const cutFloors = [...new Set(cuts.map(c => Math.round(c * floors)).filter(f => f > 0 && f < floors))].sort(
    (a, b) => a - b,
  );

  const tiers: Tier[] = [];
  let width = lot.width;
  let depth = lot.depth;
  let fromFloor = 0;
  for (const toFloor of [...cutFloors, floors]) {
    if (tiers.length > 0) {
      const inset = range(rng, 3, 8);
      const nextW = width - inset * 2;
      const nextD = depth - inset * 2;
      if (nextW >= MIN_TIER_SIDE && nextD >= MIN_TIER_SIDE) {
        width = nextW;
        depth = nextD;
      }
    }
    tiers.push({
      cx: lot.x,
      cz: lot.z,
      width,
      depth,
      y0: baseY + fromFloor * floorHeight,
      y1: baseY + toFloor * floorHeight,
    });
    fromFloor = toFloor;
  }

  const crown: Crown =
    o.crown ??
    (style === 'artdeco'
      ? pick(rng, ['stepped', 'stepped', 'spire', 'flat'] as const)
      : style === 'glass'
        ? pick(rng, ['flat', 'mast'] as const)
        : 'flat');

  return {
    lotId: lot.id,
    style,
    floorHeight,
    bayWidth,
    tiers,
    crown,
    seed: rng(),
    districtId: o.districtId,
    baseY,
  };
}

export function planBuilding(lot: Lot, baseY: number, rng: Rng): BuildingSpec {
  return massBuilding(lot, baseY, rng);
}
