import { BufferAttribute, BufferGeometry } from 'three';
import type { District } from '../../content/districts';
import type { CityLayout, Lot } from '../layout';
import { fork, int, mulberry32, range, type Rng } from '../rng';
import { planLandmark, planMonolith } from './landmarks';
import { planBuilding, type BuildingSpec, type Tier } from './massing';
import { STYLES } from './styles';

type V3 = [number, number, number];

export interface PropInstance {
  kind: 'hvac' | 'watertower' | 'antenna' | 'stairhouse';
  x: number;
  y: number;
  z: number;
  rotY: number;
  scale: number;
}

/** Collects quads with the attribute layout every city mesh shares. */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private bld: number[] = [];
  private bays: number[] = [];
  private idx: number[] = [];
  /** (seed, style index, floor height, bay width) for the vertices written next. */
  building: [number, number, number, number] = [0, 0, 0, 0];
  wallBays = 0;

  get vertexCount() {
    return this.pos.length / 3;
  }

  private vertex(p: V3, n: V3, u: number, v: number) {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.bld.push(...this.building);
    this.bays.push(this.wallBays);
  }

  /** a→b→c→d counter-clockwise as seen from the side the normal points to. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, uv: [number, number, number, number, number, number, number, number]) {
    const i = this.vertexCount;
    this.vertex(a, n, uv[0], uv[1]);
    this.vertex(b, n, uv[2], uv[3]);
    this.vertex(c, n, uv[4], uv[5]);
    this.vertex(d, n, uv[6], uv[7]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  tri(a: V3, b: V3, c: V3) {
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1;
    n[0] /= l;
    n[1] /= l;
    n[2] /= l;
    const i = this.vertexCount;
    this.vertex(a, n, a[0] + a[2], a[1]);
    this.vertex(b, n, b[0] + b[2], b[1]);
    this.vertex(c, n, c[0] + c[2], c[1]);
    this.idx.push(i, i + 1, i + 2);
  }

  /** Axis-aligned box with world-space metric UVs on every face. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, bottom = false) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [x0, y0, x1, y0, x1, y1, x0, y1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [-x1, y0, -x0, y0, -x0, y1, -x1, y1]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [-z1, y0, -z0, y0, -z0, y1, -z1, y1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [z0, y0, z1, y0, z1, y1, z0, y1]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0, -z1, x1, -z1, x1, -z0, x0, -z0]);
    if (bottom)
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0, z0, x1, z0, x1, z1, x0, z1]);
  }

  /** Four boxes framing a rectangle: belts, cornices, parapets. */
  ring(
    t: Pick<Tier, 'cx' | 'cz' | 'width' | 'depth'>,
    ya: number,
    yb: number,
    out: number,
    thick: number,
    bottom = true,
  ) {
    const x0 = t.cx - t.width / 2 - out;
    const x1 = t.cx + t.width / 2 + out;
    const z0 = t.cz - t.depth / 2 - out;
    const z1 = t.cz + t.depth / 2 + out;
    this.box(x0, ya, z1 - thick, x1, yb, z1, bottom);
    this.box(x0, ya, z0, x1, yb, z0 + thick, bottom);
    this.box(x1 - thick, ya, z0 + thick, x1, yb, z1 - thick, bottom);
    this.box(x0, ya, z0 + thick, x0 + thick, yb, z1 - thick, bottom);
  }

  cylinder(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, segments = 8) {
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const n: V3 = [Math.sin(am), 0, Math.cos(am)];
      const p = (a: number, r: number, y: number): V3 => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
      const u0 = a0 * r0;
      const u1 = a1 * r0;
      this.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1), n, [u0, y0, u1, y0, u1, y1, u0, y1]);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aBuilding', new BufferAttribute(new Float32Array(this.bld), 4));
    g.setAttribute('aBays', new BufferAttribute(new Float32Array(this.bays), 1));
    const count = this.vertexCount;
    g.setIndex(new BufferAttribute(count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export interface BuildingBuilders {
  walls: MeshBuilder;
  trims: MeshBuilder;
  roofs: MeshBuilder;
  props: PropInstance[];
}

const PIER_MIN = 0.6;

interface WallFace {
  a: V3;
  b: V3;
  n: V3;
  length: number;
}

function wallFaces(t: Tier): WallFace[] {
  const x0 = t.cx - t.width / 2;
  const x1 = t.cx + t.width / 2;
  const z0 = t.cz - t.depth / 2;
  const z1 = t.cz + t.depth / 2;
  return [
    { a: [x0, 0, z1], b: [x1, 0, z1], n: [0, 0, 1], length: t.width },
    { a: [x1, 0, z0], b: [x0, 0, z0], n: [0, 0, -1], length: t.width },
    { a: [x1, 0, z1], b: [x1, 0, z0], n: [1, 0, 0], length: t.depth },
    { a: [x0, 0, z0], b: [x0, 0, z1], n: [-1, 0, 0], length: t.depth },
  ];
}

function baysOn(length: number, bay: number) {
  const bays = Math.max(1, Math.floor((length - PIER_MIN * 2) / bay));
  return { bays, margin: (length - bays * bay) / 2 };
}

function emitWalls(spec: BuildingSpec, b: MeshBuilder) {
  for (const t of spec.tiers) {
    for (const f of wallFaces(t)) {
      const { bays, margin } = baysOn(f.length, spec.bayWidth);
      b.wallBays = bays;
      const v0 = t.y0 - spec.baseY;
      const v1 = t.y1 - spec.baseY;
      // uv.x runs along the wall with 0 at the first window bay; uv.y is height above the street.
      b.quad([f.a[0], t.y0, f.a[2]], [f.b[0], t.y0, f.b[2]], [f.b[0], t.y1, f.b[2]], [f.a[0], t.y1, f.a[2]], f.n, [
        -margin,
        v0,
        f.length - margin,
        v0,
        f.length - margin,
        v1,
        -margin,
        v1,
      ]);
    }
  }
  b.wallBays = 0;
}

function emitTrims(spec: BuildingSpec, b: MeshBuilder, rng: Rng) {
  const fh = spec.floorHeight;
  spec.tiers.forEach((t, ti) => {
    // Belt courses every 3 floors (every floor on brick works), none on curtain walls.
    if (spec.style !== 'glass') {
      const every = spec.style === 'industrial' ? 1 : 3;
      const out = spec.style === 'industrial' ? 0.12 : 0.22;
      for (let y = t.y0 + fh * every; y < t.y1 - fh * 0.5; y += fh * every) {
        b.ring(t, y - 0.12, y + 0.24, out, out + 0.1);
      }
    }
    // Storefront fascia above the ground floor.
    if (ti === 0 && spec.style !== 'glass') b.ring(t, t.y0 + fh - 0.7, t.y0 + fh - 0.05, 0.35, 0.45);
    // Cornice and parapet at every roof line.
    const corniceOut = spec.style === 'glass' ? 0.15 : spec.style === 'artdeco' ? 0.7 : 0.45;
    b.ring(t, t.y1 - 0.8, t.y1, corniceOut, corniceOut + 0.2);
    b.ring(t, t.y1, t.y1 + 1.1, 0, 0.3, false);

    if (spec.style === 'artdeco' || spec.style === 'glass') {
      const step = spec.style === 'artdeco' ? 2 : 2;
      const finW = spec.style === 'artdeco' ? 0.6 : 0.14;
      const finOut = spec.style === 'artdeco' ? 0.32 : 0.28;
      for (const f of wallFaces(t)) {
        const { bays, margin } = baysOn(f.length, spec.bayWidth);
        const dir: V3 = [(f.b[0] - f.a[0]) / f.length, 0, (f.b[2] - f.a[2]) / f.length];
        for (let k = 0; k <= bays; k += step) {
          const s = margin + k * spec.bayWidth;
          const cx = f.a[0] + dir[0] * s + f.n[0] * (finOut / 2 - 0.05);
          const cz = f.a[2] + dir[2] * s + f.n[2] * (finOut / 2 - 0.05);
          const hx = Math.abs(dir[0]) * finW * 0.5 + Math.abs(f.n[0]) * (finOut / 2 + 0.05);
          const hz = Math.abs(dir[2]) * finW * 0.5 + Math.abs(f.n[2]) * (finOut / 2 + 0.05);
          b.box(cx - hx, t.y0 + (ti === 0 ? fh : 0), cz - hz, cx + hx, t.y1 - 0.8, cz + hz);
        }
      }
    }
  });

  const top = spec.tiers[spec.tiers.length - 1];
  const side = Math.min(top.width, top.depth);
  const height = top.y1 - spec.baseY;
  if (spec.crown === 'stepped') {
    let y = top.y1;
    for (const [k, h] of [
      [0.72, 5],
      [0.5, 4.5],
      [0.3, 4],
    ] as const) {
      const s = side * k;
      b.box(top.cx - s / 2, y, top.cz - s / 2, top.cx + s / 2, y + h, top.cz + s / 2);
      b.ring({ cx: top.cx, cz: top.cz, width: s, depth: s }, y + h - 0.5, y + h, 0.3, 0.5);
      y += h;
    }
    b.cylinder(top.cx, top.cz, y, y + 6, 0.35, 0.05, 6);
  } else if (spec.crown === 'spire') {
    const base = side * 0.4;
    const h = spec.tiers.length >= 4 ? 40 : Math.max(10, height * 0.12);
    const y = top.y1 + 1.1;
    b.box(top.cx - base / 2, top.y1, top.cz - base / 2, top.cx + base / 2, y + 3, top.cz + base / 2);
    const apex: V3 = [top.cx, y + 3 + h, top.cz];
    const c: V3[] = [
      [top.cx - base / 2, y + 3, top.cz + base / 2],
      [top.cx + base / 2, y + 3, top.cz + base / 2],
      [top.cx + base / 2, y + 3, top.cz - base / 2],
      [top.cx - base / 2, y + 3, top.cz - base / 2],
    ];
    for (let i = 0; i < 4; i++) b.tri(c[i], c[(i + 1) % 4], apex);
  } else if (spec.crown === 'mast') {
    const h = range(rng, 22, 38);
    b.box(top.cx - 2, top.y1, top.cz - 2, top.cx + 2, top.y1 + 3, top.cz + 2);
    b.cylinder(top.cx, top.cz, top.y1 + 3, top.y1 + 3 + h, 0.7, 0.25, 8);
    for (const f of [0.35, 0.7]) {
      const y = top.y1 + 3 + h * f;
      b.box(top.cx - 1.4, y, top.cz - 1.4, top.cx + 1.4, y + 0.6, top.cz + 1.4, true);
    }
  }
}

function emitRoofs(spec: BuildingSpec, b: MeshBuilder) {
  for (const t of spec.tiers) {
    const x0 = t.cx - t.width / 2;
    const x1 = t.cx + t.width / 2;
    const z0 = t.cz - t.depth / 2;
    const z1 = t.cz + t.depth / 2;
    const y = t.y1 + 0.02;
    b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0, -z1, x1, -z1, x1, -z0, x0, -z0]);
  }
}

function placeProps(spec: BuildingSpec, rng: Rng, out: PropInstance[]) {
  const top = spec.tiers[spec.tiers.length - 1];
  const crownFree = spec.crown === 'flat';
  const margin = 2.2;
  const spots: [number, number, number][] = [];
  const tryPlace = (kind: PropInstance['kind'], radius: number, scale: number, t: Tier) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = t.cx + range(rng, -t.width / 2 + margin + radius, t.width / 2 - margin - radius);
      const z = t.cz + range(rng, -t.depth / 2 + margin + radius, t.depth / 2 - margin - radius);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      if (!crownFree && t === top && Math.hypot(x - t.cx, z - t.cz) < Math.min(t.width, t.depth) * 0.4 + radius)
        continue;
      if (spots.some(([sx, sz, sr]) => Math.hypot(x - sx, z - sz) < sr + radius + 0.8)) continue;
      spots.push([x, z, radius]);
      out.push({ kind, x, y: t.y1, z, rotY: int(rng, 0, 3) * (Math.PI / 2) + range(rng, -0.05, 0.05), scale });
      return;
    }
  };
  if (Math.min(top.width, top.depth) < 2 * margin + 4) return;
  if (Math.min(top.width, top.depth) >= 12) tryPlace('stairhouse', 2.6, 1, top);
  if (spec.style !== 'glass' && rng() < 0.35) tryPlace('watertower', 2.4, range(rng, 0.9, 1.15), top);
  for (let i = int(rng, 2, 6); i > 0; i--) {
    const kind = rng() < 0.82 ? 'hvac' : 'antenna';
    tryPlace(kind, kind === 'hvac' ? 1.8 : 0.6, range(rng, 0.8, 1.4), top);
  }
  // Mechanical units on setback ledges.
  for (const t of spec.tiers.slice(0, -1)) if (rng() < 0.5) tryPlace('hvac', 1.8, range(rng, 0.8, 1.2), t);
}

export function emitBuilding(spec: BuildingSpec, rng: Rng, out: BuildingBuilders) {
  const building: [number, number, number, number] = [
    spec.seed,
    STYLES[spec.style].index,
    spec.floorHeight,
    spec.bayWidth,
  ];
  out.walls.building = building;
  out.trims.building = building;
  out.roofs.building = building;
  emitWalls(spec, out.walls);
  emitTrims(spec, out.trims, rng);
  emitRoofs(spec, out.roofs);
  placeProps(spec, rng, out.props);
}

export function buildBuildingGeometry(
  spec: BuildingSpec,
  rng: Rng,
): { walls: BufferGeometry; trims: BufferGeometry; roofs: BufferGeometry; props: PropInstance[] } {
  const builders: BuildingBuilders = {
    walls: new MeshBuilder(),
    trims: new MeshBuilder(),
    roofs: new MeshBuilder(),
    props: [],
  };
  emitBuilding(spec, rng, builders);
  return {
    walls: builders.walls.build(),
    trims: builders.trims.build(),
    roofs: builders.roofs.build(),
    props: builders.props,
  };
}

export const CHUNK_SIZE = 130;

export interface CityChunk {
  key: string;
  walls: BufferGeometry;
  trims: BufferGeometry;
  roofs: BufferGeometry;
}

export interface CityBuildings {
  specs: BuildingSpec[];
  chunks: CityChunk[];
  props: PropInstance[];
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function planLot(layout: CityLayout, lot: Lot, districts: readonly District[]): BuildingSpec {
  const island = layout.islands.find(i => i.id === lot.islandId)!;
  const rng = fork(mulberry32(layout.seed), hashString(lot.id));
  if (lot.role === 'monolith') return planMonolith(lot, island.topY, rng);
  if (lot.role === 'landmark') {
    const district = districts.find(d => d.id === lot.districtId)!;
    return planLandmark(lot, district, island.topY, rng);
  }
  return planBuilding(lot, island.topY, rng);
}

export function buildCity(layout: CityLayout, districts: readonly District[]): CityBuildings {
  const specs: BuildingSpec[] = [];
  const props: PropInstance[] = [];
  const chunks = new Map<string, BuildingBuilders>();
  for (const lot of layout.lots) {
    if (lot.role === 'park') continue;
    const spec = planLot(layout, lot, districts);
    specs.push(spec);
    const key = `${lot.islandId}:${Math.floor(lot.x / CHUNK_SIZE)}:${Math.floor(lot.z / CHUNK_SIZE)}`;
    let builders = chunks.get(key);
    if (!builders) {
      builders = { walls: new MeshBuilder(), trims: new MeshBuilder(), roofs: new MeshBuilder(), props };
      chunks.set(key, builders);
    }
    emitBuilding(spec, fork(mulberry32(spec.seed * 4294967296), 7), builders);
  }
  return {
    specs,
    props,
    chunks: [...chunks].map(([key, b]) => ({
      key,
      walls: b.walls.build(),
      trims: b.trims.build(),
      roofs: b.roofs.build(),
    })),
  };
}
