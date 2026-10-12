import type { QualityTier } from '../../engine/quality';
import { LAMP_SPACING, lampPositions, streetRect } from '../ground/groundMask';
import type { CityLayout, Island, Lot } from '../layout';
import { fork, mulberry32, range, type Rng } from '../rng';

export interface Placement {
  x: number;
  y: number;
  z: number;
  /** Rotation about +Y; local +x points along (cos, 0, −sin). */
  rotY: number;
  variant: number;
}

export interface RailingSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y: number;
}

export interface FurniturePlan {
  lamps: Placement[];
  trees: Placement[];
  benches: Placement[];
  parkedCars: Placement[];
  railings: RailingSegment[];
}

const TREE_FROM_KERB = 2.2;
const BENCH_FROM_KERB = 3.0;
const CAR_FROM_KERB = 1.25;
const CAR_SPACING = 6.5;
const CAR_CLEAR_OF_CROSSING = 12;
const RAILING_SEGMENT = 2;

function insideAnyLot(lots: readonly Lot[], x: number, z: number, margin: number) {
  return lots.some(l => Math.abs(x - l.x) < l.width / 2 + margin && Math.abs(z - l.z) < l.depth / 2 + margin);
}

function islandOf(layout: CityLayout, x: number, z: number): Island | undefined {
  return layout.islands.find(i => Math.hypot(x - i.cx, z - i.cz) <= i.radius);
}

/** Lays out everything that stands on the streets. Pure and deterministic. */
export function planFurniture(layout: CityLayout, tier: QualityTier): FurniturePlan {
  const rng = mulberry32(layout.seed ^ 0xf00d);
  const rects = layout.streets.map(s => ({ s, r: streetRect(s) }));
  const builtLots = layout.lots.filter(l => l.role !== 'park');
  const plan: FurniturePlan = { lamps: [], trees: [], benches: [], parkedCars: [], railings: [] };

  // Lamps: positions from the ground mask stage, arm turned towards the street axis.
  const lampXyz = lampPositions(layout);
  for (let i = 0; i < lampXyz.length; i += 3) {
    const x = lampXyz[i];
    const z = lampXyz[i + 2];
    const own = rects.find(
      ({ r }) =>
        (r.vertical ? Math.abs(x - r.center) < r.x1 - r.x0 : Math.abs(z - r.center) < r.z1 - r.z0) &&
        x >= r.x0 - 3 &&
        x <= r.x1 + 3 &&
        z >= r.z0 - 3 &&
        z <= r.z1 + 3,
    );
    const island = islandOf(layout, x, z);
    if (!own || !island) continue;
    const toward = own.r.vertical ? Math.sign(own.r.center - x) : Math.sign(own.r.center - z);
    const rotY = own.r.vertical ? (toward > 0 ? 0 : Math.PI) : toward > 0 ? -Math.PI / 2 : Math.PI / 2;
    plan.lamps.push({ x, y: island.topY, z, rotY, variant: 0 });
  }

  const inCrossing = (x: number, z: number, self: (typeof rects)[number], margin: number) =>
    rects.some(
      o =>
        o !== self &&
        o.s.islandId === self.s.islandId &&
        x >= o.r.x0 - margin &&
        x <= o.r.x1 + margin &&
        z >= o.r.z0 - margin &&
        z <= o.r.z1 + margin,
    );

  // Street trees halfway between lamps, benches every third lamp, parked cars along the kerb.
  for (const self of rects) {
    const { s, r } = self;
    const island = layout.islands.find(i => i.id === s.islandId)!;
    const length = r.vertical ? r.z1 - r.z0 : r.x1 - r.x0;
    const at = (d: number, offset: number) =>
      r.vertical ? { x: r.center + offset, z: r.z0 + d } : { x: r.x0 + d, z: r.center + offset };
    const usable = (x: number, z: number) =>
      Math.hypot(x - island.cx, z - island.cz) < island.radius - 16 && !insideAnyLot(builtLots, x, z, 0.5);

    let k = 0;
    for (let d = LAMP_SPACING; d < length; d += LAMP_SPACING, k++) {
      for (const side of [-1, 1]) {
        // Two trees per lamp interval, a quarter spacing either side of the lamp-free midpoint.
        for (const shift of [-LAMP_SPACING / 4, LAMP_SPACING / 4]) {
          const tree = at(d + shift, side * (s.width / 2 + TREE_FROM_KERB));
          if (usable(tree.x, tree.z) && !inCrossing(tree.x, tree.z, self, 2)) {
            plan.trees.push({
              ...tree,
              y: island.topY,
              rotY: range(rng, 0, Math.PI * 2),
              variant: Math.floor(rng() * 3),
            });
          }
        }
        if (k % 3 === 1) {
          const bench = at(d - LAMP_SPACING / 2 + 3, side * (s.width / 2 + BENCH_FROM_KERB));
          if (usable(bench.x, bench.z) && !inCrossing(bench.x, bench.z, self, 2)) {
            const face = r.vertical ? (side > 0 ? Math.PI : 0) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
            plan.benches.push({ ...bench, y: island.topY, rotY: face, variant: 0 });
          }
        }
      }
    }

    if (s.kind !== 'street') continue;
    for (let d = CAR_SPACING; d < length - CAR_SPACING; d += CAR_SPACING) {
      for (const side of [-1, 1]) {
        if (rng() < 0.3) continue;
        const car = at(d, side * (s.width / 2 - CAR_FROM_KERB));
        if (Math.hypot(car.x - island.cx, car.z - island.cz) > island.radius - 18) continue;
        if (inCrossing(car.x, car.z, self, CAR_CLEAR_OF_CROSSING)) continue;
        const along = r.vertical ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? Math.PI : 0;
        plan.parkedCars.push({
          ...car,
          y: island.topY,
          rotY: along + range(rng, -0.03, 0.03),
          variant: Math.floor(rng() * 8),
        });
      }
    }
  }

  // Park trees: dart throwing with a 6 m minimum spacing.
  for (const lot of layout.lots.filter(l => l.role === 'park')) {
    const island = layout.islands.find(i => i.id === lot.islandId)!;
    const local: Placement[] = [];
    const prng: Rng = fork(rng, Math.round(lot.x * 31 + lot.z));
    const want = Math.min(40, Math.max(25, Math.floor((lot.width * lot.depth) / 36)));
    for (let attempt = 0; attempt < want * 30 && local.length < want; attempt++) {
      const x = lot.x + range(prng, -lot.width / 2 + 2, lot.width / 2 - 2);
      const z = lot.z + range(prng, -lot.depth / 2 + 2, lot.depth / 2 - 2);
      if (local.some(t => Math.hypot(t.x - x, t.z - z) < 6)) continue;
      local.push({ x, y: island.topY, z, rotY: range(prng, 0, Math.PI * 2), variant: Math.floor(prng() * 3) });
    }
    plan.trees.push(...local);
  }

  if (tier === 'low') plan.trees = plan.trees.filter((_, i) => i % 2 === 0);

  // Balustrade around every island rim, broken where bridges land.
  for (const island of layout.islands) {
    const r = island.radius - 1;
    const gaps = layout.bridges
      .filter(b => b.from === island.id || b.to === island.id)
      .map(b => {
        const [x, z] = b.from === island.id ? [b.ax, b.az] : [b.bx, b.bz];
        return { angle: Math.atan2(z - island.cz, x - island.cx), half: (b.width + 2) / 2 / r };
      });
    const steps = Math.ceil((Math.PI * 2 * r) / RAILING_SEGMENT);
    const da = (Math.PI * 2) / steps;
    for (let i = 0; i < steps; i++) {
      let a0 = i * da;
      let a1 = a0 + da;
      for (const g of gaps) {
        const rel0 = Math.atan2(Math.sin(a0 - g.angle), Math.cos(a0 - g.angle));
        const rel1 = rel0 + da;
        if (rel1 <= -g.half || rel0 >= g.half) continue;
        // Trim the segment to whichever side of the gap remains.
        if (rel0 < -g.half) a1 = a0 + (-g.half - rel0);
        else if (rel1 > g.half) a0 = a0 + (g.half - rel0);
        else a1 = a0;
      }
      if (a1 - a0 < 1e-6) continue;
      plan.railings.push({
        ax: island.cx + Math.cos(a0) * r,
        az: island.cz + Math.sin(a0) * r,
        bx: island.cx + Math.cos(a1) * r,
        bz: island.cz + Math.sin(a1) * r,
        y: island.topY,
      });
    }
  }
  return plan;
}
