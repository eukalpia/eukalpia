import type { CityLayout, Island, IslandId, Street } from '../layout';

/** Pixel of the island mask that covers world point (x, z). The mask spans the island's bounding square. */
export function worldToMask(x: number, z: number, island: Island, size: number): [number, number] {
  const u = (x - (island.cx - island.radius)) / (island.radius * 2);
  const v = (z - (island.cz - island.radius)) / (island.radius * 2);
  return [Math.min(size - 1, Math.max(0, Math.floor(u * size))), Math.min(size - 1, Math.max(0, Math.floor(v * size)))];
}

const PROMENADE = 14;
const CROSSWALK_GAP = 0.6;
const CROSSWALK_LENGTH = 3.4;

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

function streetRect(s: Street): Rect & { vertical: boolean; center: number } {
  const vertical = Math.abs(s.ax - s.bx) < 1e-6;
  const half = s.width / 2;
  return vertical
    ? { x0: s.ax - half, x1: s.ax + half, z0: Math.min(s.az, s.bz), z1: Math.max(s.az, s.bz), vertical, center: s.ax }
    : { x0: Math.min(s.ax, s.bx), x1: Math.max(s.ax, s.bx), z0: s.az - half, z1: s.az + half, vertical, center: s.az };
}

/**
 * RGBA mask over an island's bounding square: R asphalt, G paving (sidewalks, plazas, promenade),
 * B grass, A road markings (255 white, 128 amber centre line).
 */
export function rasterizeGround(layout: CityLayout, islandId: IslandId, size: number): Uint8Array {
  const island = layout.islands.find(i => i.id === islandId)!;
  const mask = new Uint8Array(size * size * 4);
  const meters = (island.radius * 2) / size;
  const worldX = (px: number) => island.cx - island.radius + (px + 0.5) * meters;
  const worldZ = (pz: number) => island.cz - island.radius + (pz + 0.5) * meters;
  const fill = (r: Rect, fn: (i: number, x: number, z: number) => void) => {
    const [px0, pz0] = worldToMask(r.x0, r.z0, island, size);
    const [px1, pz1] = worldToMask(r.x1, r.z1, island, size);
    for (let pz = pz0; pz <= pz1; pz++) {
      const z = worldZ(pz);
      if (z < r.z0 || z > r.z1) continue;
      for (let px = px0; px <= px1; px++) {
        const x = worldX(px);
        if (x < r.x0 || x > r.x1) continue;
        if (Math.hypot(x - island.cx, z - island.cz) > island.radius) continue;
        fn((pz * size + px) * 4, x, z);
      }
    }
  };

  // Everything on the island starts as paving; the rim promenade stays paving.
  fill(
    {
      x0: island.cx - island.radius,
      z0: island.cz - island.radius,
      x1: island.cx + island.radius,
      z1: island.cz + island.radius,
    },
    i => {
      mask[i + 1] = 255;
    },
  );

  const streets = layout.streets.filter(s => s.islandId === islandId).map(s => ({ s, r: streetRect(s) }));
  for (const { r } of streets) {
    fill(r, (i, x, z) => {
      if (Math.hypot(x - island.cx, z - island.cz) > island.radius - PROMENADE) return;
      mask[i] = 255;
      mask[i + 1] = 0;
    });
  }

  // Markings: amber centre lines on avenues, dashed white lane lines on streets, zebra crossings.
  for (const { s, r } of streets) {
    fill(r, (i, x, z) => {
      if (mask[i] !== 255) return;
      const across = (r.vertical ? x : z) - r.center;
      const along = r.vertical ? z : x;
      const inCrossing = streets.some(
        o => o.r.vertical !== r.vertical && (r.vertical ? z >= o.r.z0 && z <= o.r.z1 : x >= o.r.x0 && x <= o.r.x1),
      );
      if (inCrossing) return;
      const nearCrossing = streets.find(o => {
        if (o.r.vertical === r.vertical) return false;
        const d = r.vertical
          ? Math.min(Math.abs(z - o.r.z0), Math.abs(z - o.r.z1))
          : Math.min(Math.abs(x - o.r.x0), Math.abs(x - o.r.x1));
        return d >= CROSSWALK_GAP && d <= CROSSWALK_GAP + CROSSWALK_LENGTH;
      });
      if (nearCrossing && Math.abs(across) < s.width / 2 - 0.5) {
        if ((across + 100) % 1.2 < 0.6) mask[i + 3] = 255;
        return;
      }
      if (s.kind === 'avenue' && Math.abs(Math.abs(across) - 0.2) < 0.12) mask[i + 3] = 128;
      else if (s.kind === 'street' && Math.abs(across) < 0.1 && (along + 1000) % 6 < 3) mask[i + 3] = 255;
    });
  }

  // Parks are lawns.
  for (const lot of layout.lots.filter(l => l.islandId === islandId && l.role === 'park')) {
    fill(
      { x0: lot.x - lot.width / 2, z0: lot.z - lot.depth / 2, x1: lot.x + lot.width / 2, z1: lot.z + lot.depth / 2 },
      i => {
        mask[i + 1] = 0;
        mask[i + 2] = 255;
      },
    );
  }
  return mask;
}

export const LAMP_SPACING = 25;
export const LAMP_HEIGHT = 7;

/** Street lamps on both sidewalks, 1 m in from the kerb, every 25 m, skipping crossings. Flat xyz triples. */
export function lampPositions(layout: CityLayout): Float32Array {
  const out: number[] = [];
  const rects = layout.streets.map(s => ({ s, r: streetRect(s) }));
  for (const { s, r } of rects) {
    const island = layout.islands.find(i => i.id === s.islandId)!;
    const length = r.vertical ? r.z1 - r.z0 : r.x1 - r.x0;
    for (let d = LAMP_SPACING / 2; d < length; d += LAMP_SPACING) {
      for (const side of [-1, 1]) {
        const offset = side * (s.width / 2 + 1);
        const x = r.vertical ? r.center + offset : r.x0 + d;
        const z = r.vertical ? r.z0 + d : r.center + offset;
        if (Math.hypot(x - island.cx, z - island.cz) > island.radius - PROMENADE - 2) continue;
        const inRoad = rects.some(
          o =>
            o.s !== s &&
            o.s.islandId === s.islandId &&
            x >= o.r.x0 - 1 &&
            x <= o.r.x1 + 1 &&
            z >= o.r.z0 - 1 &&
            z <= o.r.z1 + 1,
        );
        if (inRoad) continue;
        out.push(x, island.topY + LAMP_HEIGHT, z);
      }
    }
  }
  return new Float32Array(out);
}

/** Warm light pools under the lamps, as an R8 mask over the island square (0..255). */
export function rasterizeLampGlow(island: Island, lamps: Float32Array, size: number): Uint8Array {
  const glow = new Float32Array(size * size);
  const meters = (island.radius * 2) / size;
  const radius = 11;
  const reach = Math.ceil(radius / meters);
  for (let i = 0; i < lamps.length; i += 3) {
    const x = lamps[i];
    const z = lamps[i + 2];
    if (Math.hypot(x - island.cx, z - island.cz) > island.radius) continue;
    const [px, pz] = worldToMask(x, z, island, size);
    for (let dz = -reach; dz <= reach; dz++)
      for (let dx = -reach; dx <= reach; dx++) {
        const qx = px + dx;
        const qz = pz + dz;
        if (qx < 0 || qz < 0 || qx >= size || qz >= size) continue;
        const d = Math.hypot(dx, dz) * meters;
        // Lamp at 7 m: inverse-square falloff times the cosine on the ground.
        const h = LAMP_HEIGHT;
        const e = (h * h * h) / Math.pow(h * h + d * d, 1.5);
        glow[qz * size + qx] += e;
      }
  }
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(255, Math.round(glow[i] * 255));
  return out;
}
