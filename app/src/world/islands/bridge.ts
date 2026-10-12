import type { BufferGeometry } from 'three';
import { MeshBuilder } from '../buildings/geometry';
import { BRIDGE_INSET, type Bridge } from '../layout';

const DECK_THICKNESS = 1.4;
const ARCH_HEIGHT = 16;
const SEGMENTS = 24;

/** A steel through-arch bridge: deck, two parabolic arches, hangers and railings. */
/**
 * Deck height at t ∈ [0, 1] along the bridge: level with each island inside its rim, then an eased
 * climb or descent with a 3 m arch over the gap, so there is never a step to walk into.
 */
export function bridgeDeckY(b: Bridge, t: number): number {
  const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
  const rim = BRIDGE_INSET / len;
  const s = Math.min(1, Math.max(0, (t - rim) / (1 - 2 * rim)));
  const ease = s * s * (3 - 2 * s);
  return b.ay + (b.by - b.ay) * ease + Math.sin(Math.PI * s) * 3;
}

export function buildBridge(b: Bridge): BufferGeometry {
  const builder = new MeshBuilder();
  const dx = b.bx - b.ax;
  const dz = b.bz - b.az;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  const sx = -uz;
  const sz = ux;
  const half = b.width / 2;
  // Deck rises gently between the two islands.
  const deckY = (t: number) => bridgeDeckY(b, t);
  const at = (t: number, s: number, y: number): [number, number, number] => [
    b.ax + dx * t + sx * s,
    y,
    b.az + dz * t + sz * s,
  ];

  for (let i = 0; i < SEGMENTS; i++) {
    const t0 = i / SEGMENTS;
    const t1 = (i + 1) / SEGMENTS;
    const y0 = deckY(t0);
    const y1 = deckY(t1);
    // Deck top, bottom and both sides.
    builder.quad(
      at(t0, -half, y0),
      at(t0, half, y0),
      at(t1, half, y1),
      at(t1, -half, y1),
      [0, 1, 0],
      [0, 0, b.width, 0, b.width, length / SEGMENTS, 0, length / SEGMENTS],
    );
    builder.quad(
      at(t1, -half, y1 - DECK_THICKNESS),
      at(t1, half, y1 - DECK_THICKNESS),
      at(t0, half, y0 - DECK_THICKNESS),
      at(t0, -half, y0 - DECK_THICKNESS),
      [0, -1, 0],
      [0, 0, 1, 0, 1, 1, 0, 1],
    );
    for (const s of [-1, 1]) {
      const e = half * s;
      const n: [number, number, number] = [sx * s, 0, sz * s];
      const quad =
        s > 0
          ? [at(t0, e, y0 - DECK_THICKNESS), at(t1, e, y1 - DECK_THICKNESS), at(t1, e, y1), at(t0, e, y0)]
          : [at(t1, e, y1 - DECK_THICKNESS), at(t0, e, y0 - DECK_THICKNESS), at(t0, e, y0), at(t1, e, y1)];
      builder.quad(quad[0], quad[1], quad[2], quad[3], n, [0, 0, 1, 0, 1, 1, 0, 1]);
      // Railing.
      const r0 = at(t0, e - s * 0.3, y0);
      const r1 = at(t1, e - s * 0.3, y1);
      boxAlong(builder, r0, r1, 0.12, 1.1);
      // Arch: parabola above each deck edge, plus a hanger at every segment.
      const a0 = at(t0, e - s * 0.6, y0 + ARCH_HEIGHT * 4 * t0 * (1 - t0));
      const a1 = at(t1, e - s * 0.6, y1 + ARCH_HEIGHT * 4 * t1 * (1 - t1));
      boxAlong(builder, [a0[0], a0[1], a0[2]], [a1[0], a1[1], a1[2]], 0.7, 0.9);
      if (i > 0) {
        const hx = a0[0];
        const hz = a0[2];
        builder.box(hx - 0.12, y0, hz - 0.12, hx + 0.12, a0[1], hz + 0.12);
      }
    }
  }
  return builder.build();
}

/** A beam of width `w` and height `h` from a to c, oriented along the segment. */
function boxAlong(b: MeshBuilder, a: [number, number, number], c: [number, number, number], w: number, h: number) {
  const dx = c[0] - a[0];
  const dz = c[2] - a[2];
  const len = Math.hypot(dx, dz) || 1;
  const sx = (-dz / len) * (w / 2);
  const sz = (dx / len) * (w / 2);
  const p = (q: [number, number, number], s: number, y: number): [number, number, number] => [
    q[0] + sx * s,
    q[1] + y,
    q[2] + sz * s,
  ];
  const n = (x: number, y: number, z: number): [number, number, number] => {
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  const uv: [number, number, number, number, number, number, number, number] = [0, 0, len, 0, len, h, 0, h];
  b.quad(p(a, -1, h), p(a, 1, h), p(c, 1, h), p(c, -1, h), [0, 1, 0], uv);
  b.quad(p(c, -1, 0), p(c, 1, 0), p(a, 1, 0), p(a, -1, 0), [0, -1, 0], uv);
  b.quad(p(a, 1, 0), p(c, 1, 0), p(c, 1, h), p(a, 1, h), n(sx, 0, sz), uv);
  b.quad(p(c, -1, 0), p(a, -1, 0), p(a, -1, h), p(c, -1, h), n(-sx, 0, -sz), uv);
}
