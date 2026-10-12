import { lampPositions, streetRect } from '../ground/groundMask';
import type { BuildingSpec } from '../buildings/massing';
import type { CityLayout, IslandId, Lot } from '../layout';
import { int, mulberry32, pick, range, type Rng } from '../rng';

export interface Crossing {
  islandId: IslandId;
  x: number;
  y: number;
  z: number;
  /** Width of the north–south street (its extent in x) and of the east–west street (extent in z). */
  wx: number;
  wz: number;
  /** Seconds into the signal cycle at t = 0. */
  offset: number;
}

export interface SignalPole {
  x: number;
  y: number;
  z: number;
  crossing: number;
  /** Which corner: the signs of (pole − crossing centre). Heads face outwards along each axis. */
  sx: number;
  sz: number;
}

export interface Awning {
  /** Centre of the top edge, where the awning meets the storefront fascia. */
  x: number;
  y: number;
  z: number;
  /** Local +z points away from the wall. */
  rotY: number;
  width: number;
  depth: number;
  color: number;
  striped: boolean;
  lotId: string;
}

export interface Sign {
  x: number;
  y: number;
  z: number;
  rotY: number;
  width: number;
  height: number;
  /** Row in the word atlas. */
  word: number;
  color: number;
  /** Fascia signs lie flat on the storefront; blade signs stick out from the wall, readable from both sides. */
  kind: 'fascia' | 'blade';
  lotId: string;
}

export interface ClutterPlan {
  crossings: Crossing[];
  signals: SignalPole[];
  awnings: Awning[];
  signs: Sign[];
}

export const WORDS = [
  'CAFE',
  'BAR',
  'PHARMACY',
  'BOOKS',
  '24/7',
  'NOODLES',
  'HOTEL',
  'DELI',
  'RECORDS',
  'BAKERY',
  'LAUNDRY',
  'CINEMA',
  'TAILOR',
  'FLOWERS',
  'RAMEN',
  'JAZZ',
  'OPTICS',
  'ARCADE',
  'MARKET',
  'TEA',
  'PIZZA',
  'REPAIR',
  'GALLERY',
  'CHAI',
] as const;

export const SIGN_COLORS = [0xfff1d6, 0xff4f7a, 0x5ee6ff, 0xffb347, 0xff3b30, 0x7dff9b, 0xc89bff];
const AWNING_COLORS = [0x23432f, 0x6b1f24, 0x1d2b47, 0xd8cdb4, 0x9c4a2a, 0x2a2a2c, 0x0f4f55];

export const SIGNAL_CYCLE = 30;
const NS_GREEN = 11.5;
const AMBER = 3;
const ALL_RED = 0.5;
const POLE_FROM_KERB = 1.2;
const FASCIA_OUT = 0.36;

export type Light = 'green' | 'amber' | 'red';

/** The light shown to each axis: north–south first, then a short all-red, then east–west. */
export function signalState(c: Crossing, t: number): { ns: Light; ew: Light } {
  const p = (((t + c.offset) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const ewStart = NS_GREEN + AMBER + ALL_RED;
  const ewGreen = SIGNAL_CYCLE - ewStart - AMBER - ALL_RED;
  const ns: Light = p < NS_GREEN ? 'green' : p < NS_GREEN + AMBER ? 'amber' : 'red';
  const e = p - ewStart;
  const ew: Light = e < 0 ? 'red' : e < ewGreen ? 'green' : e < ewGreen + AMBER ? 'amber' : 'red';
  return { ns, ew };
}

function planCrossings(layout: CityLayout, rng: Rng): Crossing[] {
  const out: Crossing[] = [];
  const rects = layout.streets.map(s => ({ s, r: streetRect(s) }));
  for (const v of rects) {
    if (!v.r.vertical) continue;
    for (const h of rects) {
      if (h.r.vertical || h.s.islandId !== v.s.islandId) continue;
      const x = v.r.center;
      const z = h.r.center;
      if (x < h.r.x0 || x > h.r.x1 || z < v.r.z0 || z > v.r.z1) continue;
      const island = layout.islands.find(i => i.id === v.s.islandId)!;
      // Every corner pole must stand on the sidewalk, inside the asphalt edge of the island.
      const reach = Math.hypot(
        Math.abs(x - island.cx) + v.s.width / 2 + 3,
        Math.abs(z - island.cz) + h.s.width / 2 + 3,
      );
      // Poles may stand on the promenade paving, but not past the rim railing.
      if (reach > island.radius - 2) continue;
      out.push({
        islandId: island.id,
        x,
        y: island.topY,
        z,
        wx: v.s.width,
        wz: h.s.width,
        offset: rng() * SIGNAL_CYCLE,
      });
    }
  }
  return out;
}

function planSignals(layout: CityLayout, crossings: Crossing[]): SignalPole[] {
  const lamps = lampPositions(layout);
  const clearOfLamps = (x: number, z: number) => {
    for (let i = 0; i < lamps.length; i += 3) if (Math.hypot(lamps[i] - x, lamps[i + 2] - z) < 1.1) return false;
    return true;
  };
  const out: SignalPole[] = [];
  crossings.forEach((c, i) => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        // Step back along the diagonal if a street lamp already stands on the corner.
        let pole = { x: 0, z: 0 };
        for (const from of [POLE_FROM_KERB, 2.0, 2.8]) {
          pole = { x: c.x + sx * (c.wx / 2 + from), z: c.z + sz * (c.wz / 2 + from) };
          if (clearOfLamps(pole.x, pole.z)) break;
        }
        out.push({ ...pole, y: c.y, crossing: i, sx, sz });
      }
  });
  return out;
}

interface Face {
  /** Wall start and end along the face, outward normal. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  nx: number;
  nz: number;
  length: number;
}

function facesOf(t: BuildingSpec['tiers'][number]): Face[] {
  const x0 = t.cx - t.width / 2;
  const x1 = t.cx + t.width / 2;
  const z0 = t.cz - t.depth / 2;
  const z1 = t.cz + t.depth / 2;
  // Each face runs left to right as seen from outside.
  return [
    { ax: x0, az: z1, bx: x1, bz: z1, nx: 0, nz: 1, length: t.width },
    { ax: x1, az: z0, bx: x0, bz: z0, nx: 0, nz: -1, length: t.width },
    { ax: x1, az: z1, bx: x1, bz: z0, nx: 1, nz: 0, length: t.depth },
    { ax: x0, az: z0, bx: x0, bz: z1, nx: -1, nz: 0, length: t.depth },
  ];
}

/** Storefront awnings and signs on the street-facing ground floors of masonry buildings. */
function planFrontages(layout: CityLayout, specs: readonly BuildingSpec[], rng: Rng) {
  const rects = layout.streets.map(streetRect);
  const lots = new Map<string, Lot>(layout.lots.map(l => [l.id, l]));
  const onStreet = (x: number, z: number) => rects.some(r => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  const awnings: Awning[] = [];
  const signs: Sign[] = [];

  for (const spec of specs) {
    const lot = lots.get(spec.lotId);
    if (!lot || lot.role !== 'filler' || spec.style === 'glass') continue;
    const t = spec.tiers[0];
    const fh = spec.floorHeight;
    for (const f of facesOf(t)) {
      // A face fronts a street if the road starts within sidewalk + setback of the lot edge.
      const mx = (f.ax + f.bx) / 2;
      const mz = (f.az + f.bz) / 2;
      const toLotEdge = f.nx !== 0 ? lot.width / 2 - Math.abs(mx - lot.x) : lot.depth / 2 - Math.abs(mz - lot.z);
      const probe = Math.max(0, toLotEdge) + 3 + 4 + 0.6;
      if (!onStreet(mx + f.nx * probe, mz + f.nz * probe)) continue;

      const rotY = Math.atan2(f.nx, f.nz);
      const ux = (f.bx - f.ax) / f.length;
      const uz = (f.bz - f.az) / f.length;
      const bays = Math.floor(f.length / spec.bayWidth);
      const margin = (f.length - bays * spec.bayWidth) / 2;
      // Group bays into shops of one to three bays.
      for (let k = 0; k < bays;) {
        const n = Math.min(bays - k, int(rng, 1, 3));
        const width = n * spec.bayWidth;
        const along = margin + k * spec.bayWidth + width / 2;
        const at = (out: number) => ({ x: f.ax + ux * along + f.nx * out, z: f.az + uz * along + f.nz * out });
        k += n;
        const roll = rng();
        if (roll < 0.42) {
          awnings.push({
            ...at(FASCIA_OUT),
            y: spec.baseY + fh - 0.55,
            rotY,
            width: width - 0.3,
            depth: range(rng, 1.3, 1.8),
            color: pick(rng, AWNING_COLORS),
            striped: rng() < 0.35,
            lotId: spec.lotId,
          });
        }
        if (roll > 0.25) {
          signs.push({
            ...at(FASCIA_OUT + 0.02),
            y: spec.baseY + fh - 0.3,
            rotY,
            width: Math.min(width - 0.4, 4.2),
            height: 0.4,
            word: int(rng, 0, WORDS.length - 1),
            color: pick(rng, SIGN_COLORS),
            kind: 'fascia',
            lotId: spec.lotId,
          });
        }
      }
      // One projecting sign on some faces, a floor and a half up, by the face's left end.
      const floors = Math.round((t.y1 - t.y0) / fh);
      if (floors >= 3 && f.length > 12 && rng() < 0.45) {
        const along = margin + spec.bayWidth * 0.5 + 0.6;
        signs.push({
          x: f.ax + ux * along + f.nx * 1.05,
          y: spec.baseY + fh * 1.6,
          z: f.az + uz * along + f.nz * 1.05,
          rotY: rotY + Math.PI / 2,
          width: 1.6,
          height: 0.42,
          word: int(rng, 0, WORDS.length - 1),
          color: pick(rng, SIGN_COLORS),
          kind: 'blade',
          lotId: spec.lotId,
        });
      }
    }
  }
  return { awnings, signs };
}

/** Everything bolted to corners and storefronts. Pure and deterministic. */
export function planClutter(layout: CityLayout, specs: readonly BuildingSpec[]): ClutterPlan {
  const rng = mulberry32(layout.seed ^ 0xc1077e);
  const crossings = planCrossings(layout, rng);
  const signals = planSignals(layout, crossings);
  const { awnings, signs } = planFrontages(layout, specs, rng);
  return { crossings, signals, awnings, signs };
}
