import {
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshPhysicalMaterial,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const CAR_KINDS = ['sedan', 'hatch', 'suv', 'van', 'taxi'] as const;
const KIND_WEIGHTS: Record<'moving' | 'parked', Record<CarKind, number>> = {
  moving: { sedan: 3, hatch: 3, suv: 2.2, van: 1, taxi: 1.8 },
  parked: { sedan: 4, hatch: 4, suv: 3, van: 1.4, taxi: 0.5 },
};

/** Body style of the n-th moving or parked car: a hashed, weighted pick (taxis mostly drive). */
export function carKindFor(n: number, moving: boolean): CarKind {
  const weights = KIND_WEIGHTS[moving ? 'moving' : 'parked'];
  const total = CAR_KINDS.reduce((s, k) => s + weights[k], 0);
  let h = Math.imul(n + 1, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  let u = (((h ^ (h >>> 13)) >>> 0) / 4294967296) * total;
  for (const k of CAR_KINDS) if ((u -= weights[k]) < 0) return k;
  return 'sedan';
}

/** Taxis are always this colour, whatever colour they were planned with. */
export const TAXI_YELLOW = 0xe3a91b;
export type CarKind = (typeof CAR_KINDS)[number];
/** Which surface a vertex belongs to; the car material shades each part differently. */
export const CAR_PART = { paint: 0, glass: 1, tyre: 2, chrome: 3, lens: 4, plate: 5, tail: 6 } as const;
/** Cars within this distance of the camera get the detailed body. */
export const LOD_NEAR = 60;
/** Head and tail lamps on the nose and tail faces (local car space, both sides of the centreline). */
export const CAR_LAMP = { y0: 0.6, y1: 0.71, z0: 0.42, z1: 0.64 } as const;

const HALF_LENGTH = 2.2;
const HALF_WIDTH = 0.9;
/** Wheel centre x (wheelbase / 2) and tyre radius per body style. */
export const WHEELS: Record<CarKind, { x: number; r: number }> = {
  sedan: { x: 1.36, r: 0.32 },
  hatch: { x: 1.3, r: 0.31 },
  suv: { x: 1.38, r: 0.37 },
  van: { x: 1.42, r: 0.33 },
  taxi: { x: 1.36, r: 0.32 },
};
const WHEEL_Z = 0.76;
const TYRE_WIDTH = 0.22;

interface Profile {
  belt: number;
  roof: number;
  /** x of the windshield base, roof front edge, roof rear edge, rear window base. */
  screen: [number, number, number, number];
  /** Height of the bonnet at the windscreen and the boot lid. */
  bonnet: number;
  boot: number;
}

const PROFILES: Record<CarKind, Profile> = {
  sedan: { belt: 0.96, roof: 1.44, screen: [0.92, 0.12, -0.9, -1.5], bonnet: 0.86, boot: 0.96 },
  hatch: { belt: 0.98, roof: 1.5, screen: [0.82, 0.02, -1.6, -2.02], bonnet: 0.86, boot: 0.98 },
  suv: { belt: 1.1, roof: 1.76, screen: [1.12, 0.45, -1.88, -2.1], bonnet: 1.02, boot: 1.1 },
  van: { belt: 1.12, roof: 1.96, screen: [1.66, 1.12, -2.1, -2.16], bonnet: 1.02, boot: 1.12 },
  taxi: { belt: 0.96, roof: 1.44, screen: [0.92, 0.12, -0.9, -1.5], bonnet: 0.86, boot: 0.96 },
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Half-width in plan view: full along the doors, rounded towards the bumpers. */
const halfWidth = (x: number) =>
  HALF_WIDTH -
  0.12 * smooth(1.6, HALF_LENGTH, Math.abs(x)) -
  0.08 * smooth(HALF_LENGTH - 0.14, HALF_LENGTH, Math.abs(x));

/** Underside: sills, rising into round arches over the wheels. */
function bottom(x: number, kind: CarKind): number {
  const { x: wx, r } = WHEELS[kind];
  const arch = r + 0.07;
  let y = 0.26;
  const dx = Math.abs(x) - wx;
  if (Math.abs(dx) < arch) y = Math.max(y, r + Math.sqrt(arch * arch - dx * dx));
  // Bumpers tuck up at the ends.
  return Math.max(y, 0.26 + 0.12 * smooth(1.9, HALF_LENGTH, Math.abs(x)));
}

/** Top of the lower body: bumper, bonnet, beltline, boot. */
function top(x: number, p: Profile): number {
  const [ws, , , rw] = p.screen;
  const noseTop = CAR_LAMP.y1 + 0.06;
  if (x > ws) {
    // Bonnet: falls from the windscreen to the nose, rounding over into the bumper.
    const t = (x - ws) / (HALF_LENGTH - ws);
    return lerp(p.bonnet, noseTop + 0.06, t * t) - 0.06 * smooth(HALF_LENGTH - 0.12, HALF_LENGTH, x);
  }
  if (x < rw) {
    const t = (rw - x) / (rw + HALF_LENGTH);
    return lerp(p.boot, noseTop + 0.08, t * t * t) - 0.06 * smooth(-HALF_LENGTH + 0.12, -HALF_LENGTH, x);
  }
  return p.belt;
}

/** Roof line over the cabin. */
function roof(x: number, p: Profile): number {
  const [ws, rf, rr, rw] = p.screen;
  if (x >= rf) return p.belt + (p.roof - p.belt) * Math.sin((Math.PI / 2) * Math.min(1, (ws - x) / (ws - rf)));
  if (x <= rr) return p.belt + (p.roof - p.belt) * Math.sin((Math.PI / 2) * Math.min(1, (x - rw) / (rr - rw)));
  // A slight crown along the roof.
  return p.roof + 0.015 * Math.sin((Math.PI * (x - rr)) / (rf - rr));
}

class Builder {
  pos: number[] = [];
  part: number[] = [];
  idx: number[] = [];
  vertex(x: number, y: number, z: number, part: number) {
    this.pos.push(x, y, z);
    this.part.push(part);
    return this.pos.length / 3 - 1;
  }
  /** A flat-shaded quad a→b→c→d (a planar loop), wound so it faces along `facing`. */
  quad(a: number[], b: number[], c: number[], d: number[], part: number, facing: number[]) {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const loop = n[0] * facing[0] + n[1] * facing[1] + n[2] * facing[2] >= 0 ? [a, b, c, d] : [a, d, c, b];
    const [i, j, k, l] = loop.map(q => this.vertex(q[0], q[1], q[2], part));
    this.idx.push(i, j, k, i, k, l);
  }
  /** Axis-aligned box with outward faces. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, part: number) {
    const q = (a: number[], b: number[], c: number[], d: number[], f: number[]) => this.quad(a, b, c, d, part, f);
    q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
    q([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [-1, 0, 0]);
    q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
    q([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [0, -1, 0]);
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(this.part), 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

type Ring = (x: number) => [number, number][];

/**
 * A smooth panel: rings of (y, z) points at each station, vertices shared inside the panel so it
 * shades smoothly. Rings run from the +z side up, over the top and down the −z side (the outside
 * is on the left walking along a ring towards −x... i.e. faces point away from the car's axis).
 */
function panel(b: Builder, stations: readonly number[], ring: Ring, part: number) {
  const first = b.pos.length / 3;
  const n = ring(stations[0]).length;
  for (const x of stations) for (const [y, z] of ring(x)) b.vertex(x, y, z, part);
  for (let s = 0; s < stations.length - 1; s++)
    for (let k = 0; k < n - 1; k++) {
      const a = first + s * n + k;
      const c = a + n + 1;
      b.idx.push(a, c, a + 1, a, a + n, c);
    }
}

/** Splits stations into runs where part(x0, x1) is constant and lofts each run as its own panel. */
function panels(b: Builder, stations: readonly number[], ring: Ring, part: (x0: number, x1: number) => number) {
  let start = 0;
  for (let s = 1; s < stations.length; s++) {
    const p = part(stations[start], stations[start + 1]);
    const last = s === stations.length - 1;
    if (last || part(stations[s], stations[s + 1]) !== p) {
      panel(b, stations.slice(start, s + 1), ring, p);
      start = s;
    }
  }
}

/** Flat end face closing a ring (front if dir = 1, rear if −1). */
function cap(b: Builder, x: number, pts: [number, number][], dir: 1 | -1) {
  const cy = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const centre = b.vertex(x, cy, 0, CAR_PART.paint);
  const ring = pts.map(([y, z]) => b.vertex(x, y, z, CAR_PART.paint));
  for (let k = 0; k < ring.length; k++) {
    const k1 = (k + 1) % ring.length;
    if (dir > 0) b.idx.push(centre, ring[k1], ring[k]);
    else b.idx.push(centre, ring[k], ring[k1]);
  }
}

/** Stations along the car: even spacing, plus dense rings through the arches and at the ends. */
function bodyStations(kind: CarKind, near: boolean): number[] {
  const { x: wx, r } = WHEELS[kind];
  const arch = r + 0.07;
  const xs: number[] = [];
  const even = near ? 12 : 5;
  for (let i = 0; i <= even; i++) xs.push(-HALF_LENGTH + (2 * HALF_LENGTH * i) / even);
  const archSteps = near ? 7 : 2;
  for (const c of [-wx, wx])
    for (let i = 0; i <= archSteps; i++) xs.push(c + arch * Math.cos((Math.PI * i) / archSteps));
  if (near) for (const e of [0.04, 0.15, 0.35]) xs.push(HALF_LENGTH - e, -HALF_LENGTH + e);
  xs.sort((a, b) => a - b);
  return xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.02);
}

function wheel(kind: CarKind, lod: 'near' | 'far', side: 1 | -1): BufferGeometry {
  const near = lod === 'near';
  const r = WHEELS[kind].r;
  const w = TYRE_WIDTH;
  const rim = r * 0.64;
  const profile = near
    ? [
        [rim, -w / 2 + 0.01],
        [r - 0.025, -w / 2],
        [r, -w / 2 + 0.04],
        [r, w / 2 - 0.04],
        [r - 0.025, w / 2],
        [rim, w / 2 - 0.01],
      ]
    : [
        // Far away only the tread band shows.
        [r, -w / 2],
        [r, w / 2],
      ];
  // Lathe normals face outwards for profiles running along +y; the lathe axis then turns to z.
  const tyre = new LatheGeometry(
    profile.map(([pr, y]) => new Vector2(pr, y)),
    near ? 12 : 6,
  ).rotateX(Math.PI / 2);
  tyre.deleteAttribute('uv');
  tyre.setAttribute(
    'aPart',
    new BufferAttribute(new Float32Array(tyre.getAttribute('position').count).fill(CAR_PART.tyre), 1),
  );
  if (!near) return tyre;
  // Alloy rim on the outer face: a hub, six spokes over a dark dished face, and a lip
  // (h = how far each ring stands out).
  const face = (side * w) / 2 - side * 0.012;
  const dish = [
    [0.0, -0.01],
    [rim * 0.3, -0.012],
    [rim * 0.8, -0.028],
    [rim, 0],
  ].map(([pr, h]) => new Vector2(pr, -h));
  const segments = 12;
  const disc = new LatheGeometry(dish, segments).toNonIndexed();
  disc.deleteAttribute('uv');
  const pos = disc.getAttribute('position');
  const parts = new Float32Array(pos.count).fill(CAR_PART.chrome);
  for (let t = 0; t < pos.count; t += 3) {
    let cx = 0;
    let cz = 0;
    for (let v = t; v < t + 3; v++) {
      cx += pos.getX(v) / 3;
      cz += pos.getZ(v) / 3;
    }
    const radius = Math.hypot(cx, cz);
    const sector = Math.floor(((((Math.atan2(cx, cz) / (2 * Math.PI)) * segments) % segments) + segments) % segments);
    if (radius > rim * 0.3 && radius < rim * 0.8 && sector % 2 === 1) parts.fill(CAR_PART.tyre, t, t + 3);
  }
  disc.setAttribute('aPart', new BufferAttribute(parts, 1));
  disc.rotateX((-side * Math.PI) / 2).translate(0, 0, face);
  return mergeGeometries([tyre.toNonIndexed(), disc])!;
}

/**
 * One car: a smooth lower body, a glass greenhouse with roof rails and pillars, dark wheel wells,
 * four wheels with alloy rims, lamps, plates, grille and mirrors (near only). Front is +x.
 */
export function carGeometry(kind: CarKind, lod: 'near' | 'far'): BufferGeometry {
  const p = PROFILES[kind];
  const near = lod === 'near';
  const b = new Builder();
  const stations = bodyStations(kind, near);

  // Lower body cross-section, +z half from the sill up to the centreline.
  const half = (x: number): [number, number][] => {
    const hw = halfWidth(x);
    const y0 = bottom(x, kind);
    const y1 = Math.max(y0 + 0.06, top(x, p));
    const crown = x > p.screen[0] ? 0.03 : 0.015;
    let prev = y0 - 1;
    const up = (y: number) => (prev = Math.max(prev + 0.004, Math.min(y, y1 + crown)));
    const pts: [number, number][] = near
      ? [
          [up(y0), hw - 0.045],
          [up(y0 + 0.07), hw - 0.006],
          [up(lerp(0.26, y1, 0.5)), hw],
          [up(y1 - 0.075), hw - 0.012],
          [up(y1 - 0.02), hw - 0.055],
          [up(y1 + crown * 0.5), hw - 0.17],
          [up(y1 + crown * 0.9), hw * 0.45],
        ]
      : [
          [up(y0), hw - 0.02],
          [up(y1), hw - 0.07],
        ];
    return pts;
  };
  const lowerRing: Ring = x => {
    const h = half(x);
    const top = Math.max(...h.map(q => q[0])) + 0.002;
    return [...h, [top, 0], ...h.map(([y, z]) => [y, -z] as [number, number]).reverse()];
  };
  panel(b, stations, lowerRing, CAR_PART.paint);
  // Underside, dark: it also roofs the wheel wells.
  panel(
    b,
    stations,
    x => {
      const h = half(x)[0];
      return [
        [h[0], -h[1]],
        [h[0], h[1]],
      ];
    },
    CAR_PART.tyre,
  );
  cap(b, stations[stations.length - 1], lowerRing(stations[stations.length - 1]), 1);
  cap(b, stations[0], lowerRing(stations[0]), -1);

  // Greenhouse: glass sides and screens, painted roof rails, roof and B-pillar.
  const [ws, rf, rr, rw] = p.screen;
  const cabin: number[] = [];
  const csteps = near ? 10 : 3;
  for (let i = 0; i <= csteps; i++) cabin.push(rw + ((ws - rw) * i) / csteps);
  const bPillar = lerp(rr, rf, 0.55);
  if (near) cabin.push(rf, rr, bPillar - 0.05, bPillar + 0.05);
  cabin.sort((a, c) => a - c);
  const cab = cabin.filter((x, i) => i === 0 || x - cabin[i - 1] > 0.015);
  const tumble = kind === 'van' ? 0.08 : 0.15;
  const glassSide = (x: number): [number, number][] => {
    const hw = halfWidth(x) - 0.075;
    const y = Math.max(p.belt + 0.002, roof(x, p));
    return [
      [p.belt, hw],
      [y, hw - tumble],
    ];
  };
  const sideGlass = (x0: number, x1: number) =>
    near && x0 >= bPillar - 0.051 && x1 <= bPillar + 0.051 ? CAR_PART.paint : CAR_PART.glass;
  panels(b, cab, glassSide, sideGlass);
  panels(
    b,
    cab,
    x =>
      glassSide(x)
        .reverse()
        .map(([y, z]) => [y, -z] as [number, number]),
    sideGlass,
  );
  // Roof rails along both edges (they form the A and C pillars along the screens).
  const rail = (x: number, s: 1 | -1): [number, number][] => {
    const [, [y, z]] = glassSide(x);
    const pts: [number, number][] = [
      [y, z],
      [y + 0.025, z - 0.07],
    ];
    return s > 0 ? pts : pts.reverse().map(([py, pz]) => [py, -pz] as [number, number]);
  };
  if (near) {
    panel(b, cab, x => rail(x, 1), CAR_PART.paint);
    panel(b, cab, x => rail(x, -1), CAR_PART.paint);
  }
  const roofTop = (x: number): [number, number][] => {
    const [, [y, z]] = glassSide(x);
    const edge = near ? z - 0.07 : z;
    const ey = near ? y + 0.025 : y;
    return [
      [ey, edge],
      [ey + 0.02, 0],
      [ey, -edge],
    ];
  };
  panels(b, cab, roofTop, (x0, x1) => (x0 >= rr - 1e-6 && x1 <= rf + 1e-6 ? CAR_PART.paint : CAR_PART.glass));

  if (near) {
    const L = HALF_LENGTH;
    for (const sz of [1, -1]) {
      const [z0, z1] = [sz * CAR_LAMP.z0, sz * CAR_LAMP.z1];
      // Lamps: head lamps face +x, tail lamps −x.
      for (const sx of [1, -1]) {
        const x = sx * (L + 0.004);
        b.quad(
          [x, CAR_LAMP.y0, z0],
          [x, CAR_LAMP.y0, z1],
          [x, CAR_LAMP.y1, z1],
          [x, CAR_LAMP.y1, z0],
          sx > 0 ? CAR_PART.lens : CAR_PART.tail,
          [sx, 0, 0],
        );
      }
      // Wing mirrors at the base of the A-pillar.
      const mx = ws - 0.12;
      const hw = halfWidth(mx);
      const my = p.belt + 0.04;
      if (sz > 0) b.box(mx - 0.09, my, hw - 0.03, mx + 0.03, my + 0.11, hw + 0.09, CAR_PART.paint);
      else b.box(mx - 0.09, my, -hw - 0.09, mx + 0.03, my + 0.11, -hw + 0.03, CAR_PART.paint);
    }
    if (kind === 'taxi') {
      // Roof sign, lit from inside: a light, matte box across the roof.
      const cx = (rf + rr) / 2;
      const y = roof(cx, p) + 0.06;
      b.box(cx - 0.24, y - 0.02, -0.3, cx + 0.24, y + 0.13, 0.3, CAR_PART.plate);
    }
    // Number plates and the front grille.
    const plate = (x: number, y: number, hw: number, part: number) =>
      b.quad([x, y, -hw], [x, y, hw], [x, y + 0.11, hw], [x, y + 0.11, -hw], part, [Math.sign(x), 0, 0]);
    plate(L + 0.006, 0.38, 0.26, CAR_PART.plate);
    plate(L + 0.003, 0.5, 0.36, CAR_PART.tyre);
    plate(-L - 0.006, 0.44, 0.26, CAR_PART.plate);
  }

  const body = b.build();
  const { x: wx, r } = WHEELS[kind];
  const wheels: BufferGeometry[] = [];
  for (const x of [-wx, wx])
    for (const side of [1, -1] as const) wheels.push(wheel(kind, lod, side).translate(x, r, side * WHEEL_Z));
  const merged = mergeGeometries([body.toNonIndexed(), ...wheels.map(g => (g.index ? g.toNonIndexed() : g))])!;
  merged.computeBoundingSphere();
  return merged;
}

/** Car paint with a clear coat; glass, tyres, chrome and lenses are carved out per vertex part. */
export function createCarMaterial(): MeshPhysicalMaterial {
  const m = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.35,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  m.name = 'CarPaint';
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vPart;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = aPart;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPart;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float carPart = floor(vPart + 0.5);
        if (carPart == 1.0) diffuseColor.rgb = vec3(0.02, 0.025, 0.03);
        else if (carPart == 2.0) diffuseColor.rgb = vec3(0.028);
        else if (carPart == 3.0) diffuseColor.rgb = vec3(0.5);
        else if (carPart == 5.0) diffuseColor.rgb = vec3(0.78, 0.78, 0.74);
        else if (carPart == 4.0) diffuseColor.rgb = vec3(0.36, 0.38, 0.4);
        else if (carPart == 6.0) diffuseColor.rgb = vec3(0.35, 0.015, 0.01);`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        if (carPart == 1.0) { material.roughness = 0.05; material.metalness = 0.0; material.clearcoat = 0.0; }
        else if (carPart == 2.0) { material.roughness = 0.88; material.metalness = 0.0; material.clearcoat = 0.0; }
        else if (carPart == 3.0) { material.roughness = 0.3; material.metalness = 1.0; material.clearcoat = 0.0; }
        else if (carPart == 5.0) { material.roughness = 0.45; material.metalness = 0.0; material.clearcoat = 0.0; }
        else if (carPart == 4.0 || carPart == 6.0) { material.roughness = 0.08; material.metalness = 0.0; }`,
      );
  };
  m.customProgramCacheKey = () => 'car-paint';
  return m;
}

export interface CarSpec {
  kind: CarKind;
  color: number;
  matrix: Matrix4;
}

export interface CarFleet {
  meshes: InstancedMesh[];
  /** Re-sorts cars into near and far bodies around the camera. */
  update(camera: Vector3): void;
  setMatrix(index: number, matrix: Matrix4): void;
  dispose(): void;
}

/** All cars of one kind of use (parked or moving), drawn as one near and one far InstancedMesh per body style. */
export function createCarFleet(
  cars: readonly CarSpec[],
  opts: { castShadow: boolean; setup?: (m: Material) => void },
): CarFleet {
  const material = createCarMaterial();
  opts.setup?.(material);
  const matrices = cars.map(c => c.matrix.clone());
  const colors = cars.map(c => new Color(c.kind === 'taxi' ? TAXI_YELLOW : c.color));
  const geometries: BufferGeometry[] = [];
  const meshes: InstancedMesh[] = [];
  const slots = new Map<string, InstancedMesh>();
  for (const kind of CAR_KINDS)
    for (const lod of ['near', 'far'] as const) {
      const g = carGeometry(kind, lod);
      geometries.push(g);
      const capacity = Math.max(1, cars.filter(c => c.kind === kind).length);
      const mesh = new InstancedMesh(g, material, capacity);
      mesh.count = 0;
      mesh.name = `cars:${kind}:${lod}`;
      // Photo mode splits the per-vertex parts into real materials.
      mesh.userData.photo = 'car';
      mesh.castShadow = opts.castShadow;
      mesh.receiveShadow = true;
      mesh.setColorAt(0, new Color());
      meshes.push(mesh);
      slots.set(`${kind}:${lod}`, mesh);
    }
  const p = new Vector3();
  const last = new Vector3(Infinity, 0, 0);
  let dirty = true;

  return {
    meshes,
    update(camera) {
      if (!dirty && camera.distanceToSquared(last) < 4) return;
      dirty = false;
      last.copy(camera);
      for (const m of meshes) m.count = 0;
      cars.forEach((car, i) => {
        p.setFromMatrixPosition(matrices[i]);
        const mesh = slots.get(`${car.kind}:${p.distanceTo(camera) < LOD_NEAR ? 'near' : 'far'}`)!;
        mesh.setMatrixAt(mesh.count, matrices[i]);
        mesh.setColorAt(mesh.count, colors[i]);
        mesh.count++;
      });
      for (const m of meshes) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere();
      }
    },
    setMatrix(index, matrix) {
      matrices[index].copy(matrix);
      dirty = true;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      material.dispose();
    },
  };
}
