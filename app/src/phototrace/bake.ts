import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type BufferGeometry,
} from 'three';
import { NIGHT_ROOM_SCALE, roomBrightness, roomLight } from '../world/buildings/facadeMaterial';
import type { StyleId } from '../world/buildings/styles';
import { STYLES } from '../world/buildings/styles';
import { rasterizeGround } from '../world/ground/groundMask';
import type { CityLayout, IslandId } from '../world/layout';

/** The facade atlas holds 16 × 16 window cells (one bay by one floor each) and repeats in both directions. */
export const FACADE_CELLS = 16;

export interface BakedMaps {
  /** Albedo, sRGB. */
  map: DataTexture;
  /** Shared linear texture: roughness in G, metalness in B (three.js channel convention). */
  roughnessMap: DataTexture;
  metalnessMap: DataTexture;
  /** Window glow at night, sRGB; null by day. */
  emissiveMap: DataTexture | null;
}

type Vec3 = [number, number, number];

/** Integer hash (PCG-style) to [0, 1); stable across platforms. */
function hash(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const seedInt = (seed: number) => Math.floor(Math.abs(seed) * 1048576) | 0;

/** Where a building starts in the atlas, so neighbours don't show the same windows. */
export function facadeOffsets(seed: number): [number, number] {
  const s = seedInt(seed);
  return [Math.floor(hash(s, 1, 7) * FACADE_CELLS), Math.floor(hash(s, 2, 7) * FACADE_CELLS)];
}

/**
 * Atlas UV for a wall point given in metres (u along the wall from the first bay, v up from the base).
 * `building` is the `aBuilding` attribute: seed, style index, floor height, bay width.
 * The ground floor maps onto the one-row storefront strip.
 */
export function facadeUV(
  uMetric: number,
  vMetric: number,
  building: readonly [number, number, number, number],
  storefront: boolean,
): [number, number] {
  const [seed, , floorH, bay] = building;
  const [offB, offF] = facadeOffsets(seed);
  const u = (uMetric / bay + offB) / FACADE_CELLS;
  const v = storefront ? vMetric / floorH : (vMetric / floorH + offF) / FACADE_CELLS;
  return [u, v];
}

/** Window opening per style as fractions of a cell: x0, x1, y0, y1 (mirrors fOpening in the facade shader). */
function opening(style: StyleId, storefront: boolean): [number, number, number, number] {
  if (storefront && style !== 'glass') return [0.06, 0.94, 0.05, 0.8];
  switch (style) {
    case 'artdeco':
      return [0.22, 0.78, 0.2, 0.82];
    case 'modernist':
      return [0.03, 0.97, 0.3, 0.8];
    case 'industrial':
      return [0.18, 0.82, 0.18, 0.76];
    default:
      return [0.015, 0.985, 0.07, 0.97];
  }
}

const mid = (r: readonly [number, number]) => (r[0] + r[1]) / 2;
const toSrgb = (c: number) => {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};
const lightColor = (h: number): Vec3 => [...roomLight(h)] as Vec3;

function texture(data: Uint8Array, width: number, height: number, srgb: boolean): DataTexture {
  const t = new DataTexture(data, width, height);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

interface CellOptions {
  style: StyleId;
  storefront: boolean;
  night: boolean;
  litRatio: number;
  seed: number;
}

/** Bakes `rows` rows of 16 cells, `cell` pixels square, in the same layout the facade shader draws. */
function bakeCells(o: CellOptions, cell: number, rows: number): BakedMaps {
  const width = cell * FACADE_CELLS;
  const height = cell * rows;
  const albedo = new Uint8Array(width * height * 4);
  const orm = new Uint8Array(width * height * 4);
  const glow = o.night ? new Uint8Array(width * height * 4) : null;
  const s = seedInt(o.seed);
  const st = STYLES[o.style];
  const bay = mid(st.bayWidth);
  const floorH = mid(st.floorHeight);
  const [x0, x1, y0, y1] = opening(o.style, o.storefront);
  const coated = o.style === 'glass';
  const tint = hash(s, 3, 1);
  const wall: Vec3 =
    o.style === 'artdeco'
      ? [0.5 + 0.08 * tint, 0.45 + 0.07 * tint, 0.36 + 0.06 * tint]
      : o.style === 'modernist'
        ? [0.34 + 0.12 * tint, 0.35 + 0.09 * tint, 0.36 + 0.04 * tint]
        : o.style === 'industrial'
          ? [0.34 + 0.06 * tint, 0.16 + 0.03 * tint, 0.11 + 0.02 * tint]
          : [0.05 + 0.04 * tint, 0.058 + 0.032 * tint, 0.065 + 0.02 * tint];
  const pane: Vec3 = coated ? [0.11, 0.14, 0.17] : [0.02, 0.025, 0.03];
  const frameTone = o.style === 'industrial' ? 0.04 : hash(s, 9, 1) < 0.5 ? 0.04 : 0.5;
  const frameW = 0.055;

  for (let row = 0; row < rows; row++) {
    // Rooms span one to three bays; some floors are mostly lit, others mostly dark.
    const floor = row + s * 31;
    const span = 1 + Math.floor(hash(floor, 7, s) * 3);
    const ratio = o.storefront ? Math.min(0.9, o.litRatio * 2.5) : o.litRatio;
    const floorLit = Math.min(0.95, ratio * (0.15 + 1.7 * hash(floor, 3, s)));
    for (let col = 0; col < FACADE_CELLS; col++) {
      const room = Math.floor(col / span);
      const h = hash(room, floor, s);
      const lit = h < floorLit;
      const light = lightColor(hash(Math.floor(h * 1e6), 21, 0));
      const strength = (NIGHT_ROOM_SCALE * roomBrightness(hash(Math.floor(h * 1e6), 25, 0))) / 4;
      const blinds = hash(Math.floor(h * 1e6), 33, 0) > 0.62 ? 0.3 + 0.6 * hash(Math.floor(h * 1e6), 35, 0) : 2;
      for (let py = 0; py < cell; py++) {
        const fy = (py + 0.5) / cell;
        for (let px = 0; px < cell; px++) {
          const fx = (px + 0.5) / cell;
          const i = (((row * cell + py) * width + col * cell + px) as number) * 4;
          // Metric position inside the cell, for frames, mullions and sills of real thickness.
          const lx = fx * bay;
          const ly = fy * floorH;
          const inOpen = fx > x0 && fx < x1 && fy > y0 && fy < y1;
          const noise = 0.9 + 0.2 * hash(col * cell + px, row * cell + py, s);
          let c: Vec3 = [wall[0] * noise, wall[1] * noise, wall[2] * noise];
          let rough = 0.82;
          let metal = coated ? 0.35 : 0;
          let e = 0;
          const sill =
            !o.storefront &&
            !coated &&
            ly > y0 * floorH - 0.09 &&
            ly < y0 * floorH &&
            lx > x0 * bay - 0.08 &&
            lx < x1 * bay + 0.08;
          if (sill) c = [0.62, 0.6, 0.56];
          if (inOpen) {
            const gx = lx - x0 * bay;
            const gy = ly - y0 * floorH;
            const gw = (x1 - x0) * bay;
            const gh = (y1 - y0) * floorH;
            let frame = gx < frameW || gy < frameW || gw - gx < frameW || gh - gy < frameW;
            if (o.style === 'artdeco') frame ||= Math.abs(gx - gw / 2) < 0.025 || Math.abs(gy - gh * 0.72) < 0.025;
            else if (o.style === 'modernist') frame ||= Math.abs(((((gx + 0.6) % 1.2) + 1.2) % 1.2) - 0.6) < 0.03;
            else if (o.style === 'industrial') {
              const pw = gw / 3;
              const ph = gh / 4;
              frame ||= Math.min(pw / 2 - Math.abs((gx % pw) - pw / 2), ph / 2 - Math.abs((gy % ph) - ph / 2)) < 0.02;
            }
            if (frame) {
              c = [frameTone, frameTone, frameTone];
              rough = 0.45;
              metal = 0.6;
            } else {
              c = pane;
              rough = coated ? 0.05 : 0.035;
              metal = coated ? 0.35 : 0;
              const shaded = fy > y0 + (y1 - y0) * blinds;
              if (lit) e = strength * (shaded ? 0.35 : 1);
            }
          }
          albedo[i] = Math.round(toSrgb(c[0]) * 255);
          albedo[i + 1] = Math.round(toSrgb(c[1]) * 255);
          albedo[i + 2] = Math.round(toSrgb(c[2]) * 255);
          albedo[i + 3] = 255;
          orm[i] = 255;
          orm[i + 1] = Math.round(rough * 255);
          orm[i + 2] = Math.round(metal * 255);
          orm[i + 3] = 255;
          if (glow) {
            glow[i] = Math.round(toSrgb(light[0] * e) * 255);
            glow[i + 1] = Math.round(toSrgb(light[1] * e) * 255);
            glow[i + 2] = Math.round(toSrgb(light[2] * e) * 255);
            glow[i + 3] = 255;
          }
        }
      }
    }
  }
  const ormTex = texture(orm, width, height, false);
  return {
    map: texture(albedo, width, height, true),
    roughnessMap: ormTex,
    metalnessMap: ormTex,
    emissiveMap: glow ? texture(glow, width, height, true) : null,
  };
}

/**
 * Facade maps for one style: `upper` is the 16 × 16 atlas for every floor above the street,
 * `ground` the one-row strip of storefronts (lobbies on curtain walls).
 */
export function bakeFacade(
  style: StyleId,
  opts: { night: boolean; litRatio: number; seed: number; size?: number },
): { upper: BakedMaps; ground: BakedMaps } {
  const cell = Math.max(4, Math.floor((opts.size ?? 1024) / FACADE_CELLS));
  const base = { style, night: opts.night, litRatio: opts.litRatio, seed: opts.seed };
  return {
    upper: bakeCells({ ...base, storefront: false }, cell, FACADE_CELLS),
    ground: bakeCells({ ...base, storefront: true }, cell, 1),
  };
}

/** Albedo and roughness of an island's ground, from the same mask and colours as the ground shader. */
export function bakeGround(layout: CityLayout, islandId: IslandId, size: number): BakedMaps {
  const mask = rasterizeGround(layout, islandId, size);
  const albedo = new Uint8Array(size * size * 4);
  const orm = new Uint8Array(size * size * 4);
  const island = layout.islands.find(i => i.id === islandId)!;
  const meters = (island.radius * 2) / size;
  for (let pz = 0; pz < size; pz++)
    for (let px = 0; px < size; px++) {
      const i = (pz * size + px) * 4;
      const n = 0.85 + 0.3 * hash(px, pz, 11);
      // Paving joints every 0.6 m.
      const wx = (px + 0.5) * meters;
      const wz = (pz + 0.5) * meters;
      const joint = Math.min(wx % 0.6, wz % 0.6) < meters * 0.5 ? 0.55 : 1;
      let c: Vec3 = [0.2 * n * joint, 0.195 * n * joint, 0.185 * n * joint];
      let rough = 0.8;
      if (mask[i + 2] > 127) {
        c = [0.045 * n, 0.072 * n, 0.028 * n];
        rough = 0.95;
      }
      if (mask[i] > 127) {
        c = [0.052 * n, 0.054 * n, 0.058 * n];
        rough = 0.88;
        if (mask[i + 3] > 191) c = [0.62, 0.62, 0.6];
        else if (mask[i + 3] > 63) c = [0.55, 0.38, 0.08];
      }
      albedo[i] = Math.round(toSrgb(c[0]) * 255);
      albedo[i + 1] = Math.round(toSrgb(c[1]) * 255);
      albedo[i + 2] = Math.round(toSrgb(c[2]) * 255);
      albedo[i + 3] = 255;
      orm[i] = 255;
      orm[i + 1] = Math.round(rough * 255);
      orm[i + 2] = 0;
      orm[i + 3] = 255;
    }
  const ormTex = texture(orm, size, size, false);
  const map = texture(albedo, size, size, true);
  map.wrapS = map.wrapT = ormTex.wrapS = ormTex.wrapT = 1001; // ClampToEdgeWrapping
  return { map, roughnessMap: ormTex, metalnessMap: ormTex, emissiveMap: null };
}

/** Box-projected UVs for the island rock: the dominant normal axis picks the plane, in metres × scale. */
export function rockUVs(geometry: BufferGeometry, scale: number): Float32Array {
  const pos = geometry.getAttribute('position');
  const nor = geometry.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    const x = pos.getX(i) * scale;
    const y = pos.getY(i) * scale;
    const z = pos.getZ(i) * scale;
    if (ay >= ax && ay >= az) ((uv[i * 2] = x), (uv[i * 2 + 1] = z));
    else if (ax >= az) ((uv[i * 2] = z), (uv[i * 2 + 1] = y));
    else ((uv[i * 2] = x), (uv[i * 2 + 1] = y));
  }
  return uv;
}
