export type Rng = () => number;

/** mulberry32, the same generator v1 used, so seeds stay meaningful. */
export function mulberry32(seed: number): Rng {
  let state = seed | 0;
  return () => {
    state = (state + 1831565813) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(r: Rng, a: number, b: number): number {
  return a + (b - a) * r();
}

export function int(r: Rng, a: number, b: number): number {
  return Math.floor(range(r, a, b + 1));
}

export function pick<T>(r: Rng, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))];
}

/** An independent stream derived from `r`, so adding draws in one subsystem never reshuffles another. */
export function fork(r: Rng, salt: number): Rng {
  return mulberry32((Math.floor(r() * 4294967296) ^ Math.imul(salt, 2654435761)) | 0);
}

export function shuffle<T>(r: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
