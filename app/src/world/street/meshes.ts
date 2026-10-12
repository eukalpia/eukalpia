import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Quaternion,
  RGBADepthPacking,
  SRGBColorSpace,
  Vector3,
  type Material,
} from 'three';
import type { SunRig } from '../../engine/lighting/sun';
import { TIER_SETTINGS, type CasterKind, type QualityTier } from '../../engine/quality';
import { MeshBuilder } from '../buildings/geometry';
import { carKindFor, createCarFleet, type CarFleet } from './cars';
import { createBarkMaterial, createTrunkLod, fadeNearCamera, trunkGeometry, type TrunkLod } from './trees';
import { mulberry32, range } from '../rng';
import type { FurniturePlan, Placement } from './furniture';

export const LAMP_ARM = 1.3;
export const LAMP_HEAD_Y = 7;

function lampGeometry(): { post: BufferGeometry; lens: BufferGeometry } {
  const b = new MeshBuilder();
  b.box(-0.18, 0, -0.18, 0.18, 0.5, 0.18);
  b.cylinder(0, 0, 0.5, LAMP_HEAD_Y + 0.25, 0.09, 0.065, 8);
  b.box(0, LAMP_HEAD_Y + 0.15, -0.04, LAMP_ARM, LAMP_HEAD_Y + 0.25, 0.04);
  b.box(LAMP_ARM - 0.35, LAMP_HEAD_Y - 0.05, -0.22, LAMP_ARM + 0.35, LAMP_HEAD_Y + 0.2, 0.22, true);
  const lens = new MeshBuilder();
  lens.box(LAMP_ARM - 0.3, LAMP_HEAD_Y - 0.09, -0.18, LAMP_ARM + 0.3, LAMP_HEAD_Y - 0.04, 0.18, true);
  return { post: b.build(), lens: lens.build() };
}

function benchGeometry(): BufferGeometry {
  const b = new MeshBuilder();
  b.box(-0.9, 0.42, -0.22, 0.9, 0.48, 0.22);
  b.box(-0.9, 0.5, 0.18, 0.9, 0.9, 0.24);
  for (const x of [-0.75, 0.75]) b.box(x - 0.04, 0, -0.2, x + 0.04, 0.85, 0.22);
  return b.build();
}

/** Car body along local +x: 4.4 m long, 1.85 m wide. Glass is a separate mesh. */
/** A tree: tapered trunk, three boughs and a crown of leaf cards. Leaf cards carry uv for the leaf texture. */
function treeGeometry(
  variant: number,
  cards: number,
): { wood: BufferGeometry; woodFar: BufferGeometry; leaves: BufferGeometry } {
  const rng = mulberry32(1000 + variant);
  const height = [5.5, 7, 8.5][variant];
  const trunkRadius = [0.18, 0.21, 0.24][variant];
  const wood = trunkGeometry(height, trunkRadius, 1000 + variant);
  const woodFar = trunkGeometry(height, trunkRadius, 1000 + variant, 'far');
  const crownY = height * 0.62;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  // Fewer cards on Low are scaled up so the crown keeps its coverage.
  const grow = Math.sqrt(130 / cards);
  const radius = [2.2, 2.8, 3.2][variant];
  for (let i = 0; i < cards; i++) {
    // Uniform-ish point in an ellipsoid crown.
    const u = rng() * 2 - 1;
    const t = rng() * Math.PI * 2;
    const r = Math.cbrt(rng());
    const s = Math.sqrt(1 - u * u);
    const cx = Math.cos(t) * s * r * radius;
    const cz = Math.sin(t) * s * r * radius;
    const cy = crownY + u * r * radius * 0.8;
    const size = range(rng, 0.75, 1.1) * grow;
    // Random orientation for each card.
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      rng() * Math.PI,
    );
    const ax = new Vector3(size / 2, 0, 0).applyQuaternion(q);
    const ay = new Vector3(0, size / 2, 0).applyQuaternion(q);
    // Normals point away from the crown centre so the canopy shades like a volume.
    const n = new Vector3(cx, (cy - crownY) * 1.2, cz).normalize();
    const base = pos.length / 3;
    for (const [sx, sy, su, sv] of [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ]) {
      pos.push(cx + ax.x * sx + ay.x * sy, cy + ax.y * sx + ay.y * sy, cz + ax.z * sx + ay.z * sy);
      nor.push(n.x, n.y, n.z);
      uv.push(su, sv);
      // Leaves deep inside the crown and on its underside get less light.
      const ao = 0.45 + 0.55 * Math.min(1, r * 1.1) * (0.75 + 0.25 * Math.max(0, n.y));
      col.push(ao, ao, ao);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const leaves = new BufferGeometry();
  leaves.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  leaves.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  leaves.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  leaves.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  leaves.setIndex(idx);
  leaves.computeBoundingSphere();
  return { wood, woodFar, leaves };
}

/** Draws a cluster of leaves with alpha into a canvas (browser only). */
function leafTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const rng = mulberry32(77);
  for (let i = 0; i < 90; i++) {
    const x = size * (0.12 + 0.76 * rng());
    const y = size * (0.12 + 0.76 * rng());
    const a = rng() * Math.PI * 2;
    const l = 12 + 10 * rng();
    const tone = 0.7 + 0.6 * rng();
    // Muted olive greens with a few yellowed leaves.
    const yellow = rng() < 0.12 ? 1.35 : 1;
    g.fillStyle = `rgb(${Math.round(58 * tone * yellow)}, ${Math.round(72 * tone)}, ${Math.round(38 * tone)})`;
    g.beginPath();
    g.ellipse(x, y, l, l * 0.42, a, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function railingGeometry(plan: FurniturePlan): BufferGeometry {
  const b = new MeshBuilder();
  for (const r of plan.railings) {
    const len = Math.hypot(r.bx - r.ax, r.bz - r.az);
    const posts = Math.max(1, Math.round(len / 1.2));
    for (let i = 0; i < posts; i++) {
      const t = i / posts;
      const x = r.ax + (r.bx - r.ax) * t;
      const z = r.az + (r.bz - r.az) * t;
      b.box(x - 0.05, r.y, z - 0.05, x + 0.05, r.y + 1.05, z + 0.05);
    }
    // Rail: a thin bar along the segment.
    const dx = (r.bx - r.ax) / len;
    const dz = (r.bz - r.az) / len;
    const sx = -dz * 0.06;
    const sz = dx * 0.06;
    const y0 = r.y + 1.02;
    const y1 = r.y + 1.12;
    const p = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
    b.quad(
      p(r.ax - sx, y1, r.az - sz),
      p(r.ax + sx, y1, r.az + sz),
      p(r.bx + sx, y1, r.bz + sz),
      p(r.bx - sx, y1, r.bz - sz),
      [0, 1, 0],
      [0, 0, 1, 0, 1, 1, 0, 1],
    );
    b.quad(
      p(r.ax + sx, y0, r.az + sz),
      p(r.bx + sx, y0, r.bz + sz),
      p(r.bx + sx, y1, r.bz + sz),
      p(r.ax + sx, y1, r.az + sz),
      [-dz, 0, dx],
      [0, 0, 1, 0, 1, 1, 0, 1],
    );
    b.quad(
      p(r.bx - sx, y0, r.bz - sz),
      p(r.ax - sx, y0, r.az - sz),
      p(r.ax - sx, y1, r.az - sz),
      p(r.bx - sx, y1, r.bz - sz),
      [dz, 0, -dx],
      [0, 0, 1, 0, 1, 1, 0, 1],
    );
  }
  return b.build();
}

export const CAR_COLORS = [0x1c1d20, 0xd9d9d6, 0x8a8d91, 0x2b3a55, 0x7a1f1f, 0x3f4a3c, 0xb8a27a, 0x0f2a44];

function placementMatrix(it: Placement): Matrix4 {
  return new Matrix4().compose(
    new Vector3(it.x, it.y, it.z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), it.rotY),
    new Vector3(1, 1, 1),
  );
}

function instanced(
  geometry: BufferGeometry,
  material: Material,
  items: Placement[],
  name: string,
  cast = true,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, Math.max(1, items.length));
  mesh.count = items.length;
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const p = new Vector3();
  items.forEach((it, i) =>
    mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q.setFromAxisAngle(up, it.rotY), one)),
  );
  mesh.computeBoundingSphere();
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  mesh.name = name;
  return mesh;
}

export interface StreetMeshes {
  group: Group;
  /** World positions of every lamp head, xyz triples. */
  lampHeads: Float32Array;
  /** Parked cars, detailed near the camera. */
  parked: CarFleet;
  /** Re-sorts near and far car bodies around the camera. */
  update(camera: Vector3): void;
  setNight(night: boolean): void;
  dispose(): void;
}

export function createStreetMeshes(plan: FurniturePlan, ctx: { sun: SunRig; tier: QualityTier }): StreetMeshes {
  const group = new Group();
  group.name = 'Street';
  const tier = TIER_SETTINGS[ctx.tier];
  const casts = (kind: CasterKind) => tier.shadowCasters.has(kind);
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const metal = keep(new MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.7 }));
  const lensMaterial = keep(
    new MeshStandardMaterial({ color: 0xfff1d8, emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.3 }),
  );
  const wood = keep(new MeshStandardMaterial({ color: 0x4a3626, roughness: 0.85 }));
  const bark = keep(createBarkMaterial());
  const leafMap = keep(leafTexture());
  const leaves = keep(
    new MeshStandardMaterial({ map: leafMap, alphaTest: 0.45, side: DoubleSide, roughness: 0.8, vertexColors: true }),
  );
  const leafDepth = keep(new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: leafMap, alphaTest: 0.45 }));
  const rail = keep(new MeshStandardMaterial({ color: 0x23272b, roughness: 0.45, metalness: 0.8 }));
  for (const m of [metal, wood, bark, leaves, rail]) ctx.sun.setupMaterial(m);
  fadeNearCamera(leaves);

  const lamp = lampGeometry();
  disposables.push(lamp.post, lamp.lens);
  group.add(instanced(lamp.post, metal, plan.lamps, 'lamp-posts', casts('street')));
  const lenses = instanced(lamp.lens, lensMaterial, plan.lamps, 'lamp-lenses');
  lenses.castShadow = false;
  group.add(lenses);

  const trunkLods: TrunkLod[] = [];
  for (let v = 0; v < 3; v++) {
    const items = plan.trees.filter(t => t.variant === v);
    const g = treeGeometry(v, tier.leafCards);
    disposables.push(g.wood, g.woodFar, g.leaves);
    const trunks = createTrunkLod(g.wood, g.woodFar, bark, items.map(placementMatrix), {
      name: `tree-wood-${v}`,
      castShadow: casts('tree'),
    });
    trunkLods.push(trunks);
    group.add(trunks.near, trunks.far);
    const crown = instanced(g.leaves, leaves, items, `tree-leaves-${v}`, casts('tree'));
    crown.customDepthMaterial = leafDepth;
    // Tint each crown slightly so streets don't look cloned.
    const c = new Color();
    items.forEach((_, i) =>
      crown.setColorAt(i, c.setHSL(0.2 + 0.04 * Math.sin(i * 12.9898), 0.25, 0.62 + 0.1 * Math.sin(i * 78.233))),
    );
    if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
    group.add(crown);
  }

  const bench = keep(benchGeometry());
  group.add(instanced(bench, wood, plan.benches, 'benches', casts('street')));

  const m4 = new Matrix4();
  const q4 = new Quaternion();
  const parked = keep(
    createCarFleet(
      plan.parkedCars.map((p, i) => ({
        kind: carKindFor(i, false),
        color: CAR_COLORS[p.variant % CAR_COLORS.length],
        matrix: m4
          .clone()
          .compose(new Vector3(p.x, p.y, p.z), q4.setFromAxisAngle(new Vector3(0, 1, 0), p.rotY), new Vector3(1, 1, 1)),
      })),
      { castShadow: casts('vehicle'), setup: m => ctx.sun.setupMaterial(m as MeshStandardMaterial) },
    ),
  );
  group.add(...parked.meshes);

  const railing = keep(railingGeometry(plan));
  const railMesh = new InstancedMesh(railing, rail, 1);
  railMesh.setMatrixAt(0, new Matrix4());
  railMesh.computeBoundingSphere();
  railMesh.castShadow = casts('street');
  railMesh.receiveShadow = true;
  railMesh.name = 'railings';
  group.add(railMesh);

  const lampHeads = new Float32Array(plan.lamps.length * 3);
  plan.lamps.forEach((l, i) => {
    lampHeads[i * 3] = l.x + Math.cos(l.rotY) * LAMP_ARM;
    lampHeads[i * 3 + 1] = l.y + LAMP_HEAD_Y - 0.2;
    lampHeads[i * 3 + 2] = l.z - Math.sin(l.rotY) * LAMP_ARM;
  });

  return {
    group,
    lampHeads,
    parked,
    update(camera) {
      parked.update(camera);
      for (const t of trunkLods) t.update(camera);
    },
    setNight(night) {
      lensMaterial.emissiveIntensity = night ? 9 : 0;
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
