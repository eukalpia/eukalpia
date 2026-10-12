import { BufferAttribute, BufferGeometry, CatmullRomCurve3, TubeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Island } from '../layout';
import { int, range, type Rng } from '../rng';

/** Small deterministic 3D value noise for rock displacement (CPU side). */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const w = s(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

export function fbm3(x: number, y: number, z: number, octaves = 5): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (valueNoise(x * f, y * f, z * f) * 2 - 1);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

const RIM_WIDTH = 6;

/** Radius of the underside profile at depth fraction v (0 at the rim, 1 at the tip). */
export function rockRadius(island: Island, v: number): number {
  const bulge = 1 + 0.05 * Math.sin(Math.PI * Math.min(v * 2.2, 1));
  return island.radius * bulge * Math.pow(Math.max(0, 1 - v), 0.8);
}

export function rockY(island: Island, v: number): number {
  return island.topY - 1.5 - island.depth * Math.pow(v, 1.08) * 0.985;
}

/**
 * The floating rock: a flat rim ring at topY and an inverted, noise-carved cone below it,
 * with stalactites hanging from the lower half.
 */
export function buildIslandRock(island: Island, rng: Rng): BufferGeometry {
  const big = island.id === 'main';
  const seg = big ? 256 : 128;
  const rows = big ? 96 : 48;
  const seed = int(rng, 0, 1000);
  const pos: number[] = [];
  const idx: number[] = [];

  // Rim ring: two loops at topY (slightly below the ground disc to avoid z-fighting).
  const rimY = island.topY - 0.05;
  for (const r of [island.radius - RIM_WIDTH, island.radius]) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pos.push(island.cx + Math.cos(a) * r, rimY, island.cz + Math.sin(a) * r);
    }
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    idx.push(i, j, seg + i, j, seg + j, seg + i);
  }

  // Underside rows. Row 0 sits on the rim edge so the surfaces join.
  const base = pos.length / 3;
  const amp = island.radius * 0.12;
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    const radius = rockRadius(island, v);
    const y = row === 0 ? rimY : rockY(island, v);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      // Carve with fbm; strata add horizontal ledges; the rim row stays clean.
      const n = fbm3(nx * 3 + seed, y / 60, nz * 3 - seed);
      const strata = Math.sin(y * 0.22 + fbm3(nx * 6, y / 25, nz * 6) * 4) * 0.025 * island.radius * v;
      const push = row === 0 ? 0 : (n * amp + strata) * Math.min(1, v * 6) * (1 - v * 0.35);
      const r = Math.max(0.5, radius + push);
      const dy = row === 0 || row === rows ? 0 : fbm3(nx * 5 - seed, y / 40, nz * 5) * amp * 0.25;
      pos.push(island.cx + nx * r, Math.min(rimY, y + dy), island.cz + nz * r);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const a = base + row * seg + i;
      const b = base + row * seg + j;
      const c = base + (row + 1) * seg + i;
      const d = base + (row + 1) * seg + j;
      idx.push(a, b, c, b, d, c);
    }
  }

  const rock = new BufferGeometry();
  rock.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  rock.setIndex(idx);
  rock.computeVertexNormals();

  // Stalactites: noisy cones from the lower half, never deeper than ~10% past the tip.
  const parts: BufferGeometry[] = [rock];
  const count = big ? int(rng, 28, 40) : int(rng, 14, 22);
  const floor = island.topY - island.depth * 1.1;
  for (let k = 0; k < count; k++) {
    const v = range(rng, 0.38, 0.92);
    const a = range(rng, 0, Math.PI * 2);
    const r0 = rockRadius(island, v) * 0.9;
    const y0 = rockY(island, v) + 2;
    const length = Math.min(range(rng, 15, 60) * (big ? 1 : 0.6), y0 - floor);
    if (length < 6) continue;
    const width = range(rng, 0.12, 0.25) * length;
    parts.push(stalactite(island.cx + Math.cos(a) * r0, y0, island.cz + Math.sin(a) * r0, width, length, rng));
  }
  for (const part of parts) part.computeVertexNormals();
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function stalactite(x: number, y: number, z: number, width: number, length: number, rng: Rng): BufferGeometry {
  const seg = 7;
  const rows = 6;
  const pos: number[] = [];
  const idx: number[] = [];
  const twist = range(rng, 0, 10);
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const r = width * Math.pow(1 - t, 1.3) + 0.05;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const jitter = 1 + (valueNoise(i * 1.7 + twist, row * 1.3, twist) - 0.5) * 0.5;
      pos.push(x + Math.cos(a) * r * jitter, y - t * length, z + Math.sin(a) * r * jitter);
    }
  }
  for (let row = 0; row < rows; row++)
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      const a = row * seg + i;
      const b = row * seg + j;
      const c = (row + 1) * seg + i;
      const d = (row + 1) * seg + j;
      idx.push(a, b, c, b, d, c);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

/** Roots dangling from the lower part of the rock. */
export function buildRoots(island: Island, rng: Rng): BufferGeometry {
  const big = island.id === 'main';
  const count = big ? int(rng, 60, 80) : int(rng, 40, 55);
  const tubes: BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const v = range(rng, 0.3, 0.85);
    const a = range(rng, 0, Math.PI * 2);
    const r0 = rockRadius(island, v) * 0.95;
    const start = new Vector3(island.cx + Math.cos(a) * r0, rockY(island, v) + 1, island.cz + Math.sin(a) * r0);
    const length = range(rng, 15, 70) * (big ? 1 : 0.6);
    const out = new Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(range(rng, -0.3, 0.3) * length);
    const points = [
      start,
      start
        .clone()
        .addScaledVector(out, length * 0.12)
        .add(new Vector3(0, -length * 0.25, 0)),
      start
        .clone()
        .addScaledVector(out, length * 0.18)
        .add(side.clone().multiplyScalar(0.5))
        .add(new Vector3(0, -length * 0.6, 0)),
      start
        .clone()
        .addScaledVector(out, length * 0.1)
        .add(side)
        .add(new Vector3(0, -length, 0)),
    ];
    const radius = range(rng, 0.4, 1.6) * (big ? 1 : 0.7);
    const tube = new TubeGeometry(new CatmullRomCurve3(points), 10, radius, 6, false);
    // Taper towards the tip.
    const p = tube.getAttribute('position');
    const center = new Vector3();
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      new CatmullRomCurve3(points).getPointAt(t, center);
      for (let j = 0; j <= 6; j++) {
        const vi = i * 7 + j;
        const s = 1 - t * 0.85;
        p.setXYZ(
          vi,
          center.x + (p.getX(vi) - center.x) * s,
          center.y + (p.getY(vi) - center.y) * s,
          center.z + (p.getZ(vi) - center.z) * s,
        );
      }
    }
    tube.deleteAttribute('uv');
    tubes.push(tube);
  }
  const merged = mergeGeometries(tubes);
  for (const t of tubes) t.dispose();
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}
