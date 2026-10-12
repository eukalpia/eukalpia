import { mulberry32 } from '../../world/rng';

const wrap = (i: number, period: number) => ((i % period) + period) % period;

function makeHash(seed: number) {
  const r = mulberry32(seed);
  const perm = new Uint16Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  return (x: number, y: number, z: number) => perm[perm[perm[x & 255] + (y & 255)] + (z & 255)];
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

function grad(h: number, x: number, y: number, z: number) {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}

/** Periodic Perlin noise in [-1, 1] with `period` lattice cells per unit. */
function perlin(hash: ReturnType<typeof makeHash>, x: number, y: number, z: number, period: number): number {
  const px = x * period;
  const py = y * period;
  const pz = z * period;
  const xi = Math.floor(px);
  const yi = Math.floor(py);
  const zi = Math.floor(pz);
  const xf = px - xi;
  const yf = py - yi;
  const zf = pz - zi;
  const u = fade(xf);
  const v = fade(yf);
  const w = fade(zf);
  const h = (dx: number, dy: number, dz: number) =>
    hash(wrap(xi + dx, period), wrap(yi + dy, period), wrap(zi + dz, period));
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(
      lerp(grad(h(0, 0, 0), xf, yf, zf), grad(h(1, 0, 0), xf - 1, yf, zf), u),
      lerp(grad(h(0, 1, 0), xf, yf - 1, zf), grad(h(1, 1, 0), xf - 1, yf - 1, zf), u),
      v,
    ),
    lerp(
      lerp(grad(h(0, 0, 1), xf, yf, zf - 1), grad(h(1, 0, 1), xf - 1, yf, zf - 1), u),
      lerp(grad(h(0, 1, 1), xf, yf - 1, zf - 1), grad(h(1, 1, 1), xf - 1, yf - 1, zf - 1), u),
      v,
    ),
    w,
  );
}

/** Periodic Worley noise: distance to the nearest feature point, 0 at a point, ~1 between. */
function worley(points: Float32Array, x: number, y: number, z: number, cells: number): number {
  const px = x * cells;
  const py = y * cells;
  const pz = z * cells;
  const xi = Math.floor(px);
  const yi = Math.floor(py);
  const zi = Math.floor(pz);
  let best = 4;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const cz = zi + dz;
        const k = (wrap(cx, cells) + cells * (wrap(cy, cells) + cells * wrap(cz, cells))) * 3;
        const fx = cx + points[k] - px;
        const fy = cy + points[k + 1] - py;
        const fz = cz + points[k + 2] - pz;
        best = Math.min(best, fx * fx + fy * fy + fz * fz);
      }
  return Math.min(1, Math.sqrt(best));
}

function featurePoints(seed: number, cells: number): Float32Array {
  const r = mulberry32(seed);
  const out = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < out.length; i++) out[i] = r();
  return out;
}

/**
 * A tileable size³ Perlin-Worley volume (bytes), the usual base shape for raymarched clouds:
 * billowy Worley cells eroding low-frequency Perlin.
 */
export function generateCloudNoise(size: number, seed: number): Uint8Array {
  const hash = makeHash(seed);
  const w1 = featurePoints(seed + 1, 4);
  const w2 = featurePoints(seed + 2, 8);
  const w3 = featurePoints(seed + 3, 16);
  const values = new Float32Array(size * size * size);
  let lo = Infinity;
  let hi = -Infinity;
  for (let z = 0; z < size; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const v = y / size;
        const w = z / size;
        const p = perlin(hash, u, v, w, 4) * 0.6 + perlin(hash, u, v, w, 8) * 0.28 + perlin(hash, u, v, w, 16) * 0.12;
        const cells =
          (1 - worley(w1, u, v, w, 4)) * 0.625 +
          (1 - worley(w2, u, v, w, 8)) * 0.25 +
          (1 - worley(w3, u, v, w, 16)) * 0.125;
        const perlin01 = p * 0.5 + 0.5;
        // Remap Perlin into the Worley range: keeps Perlin's large shapes, Worley's billows.
        const value = cells - 1 + perlin01 > 0 ? (perlin01 - (cells - 1)) / (1 - (cells - 1)) : 0;
        const i = x + size * (y + size * z);
        values[i] = value;
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
  const out = new Uint8Array(values.length);
  const span = hi - lo || 1;
  for (let i = 0; i < values.length; i++) out[i] = Math.round(((values[i] - lo) / span) * 255);
  return out;
}
