import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PointLight,
  Scene,
  Vector3,
  type Camera,
  type InstancedMesh,
  type Material,
  type Object3D,
  type SkinnedMesh,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STYLE_IDS } from '../world/buildings/styles';
import type { CityLayout, IslandId } from '../world/layout';
import { CAR_PART } from '../world/street/cars';
import { bakeFacade, bakeGround, facadeUV, rockUVs, type BakedMaps } from './bake';

/**
 * How a mesh enters the photo scene, set as `userData.photo` by the module that builds it.
 * Unset means: copy its standard material as it is.
 */
export type PhotoRole = 'facade' | 'trim' | 'roof' | 'rock' | 'ground' | 'car' | 'skip';

export interface PhotoSceneOptions {
  night: boolean;
  litRatio: number;
  layout: CityLayout;
  camera: Camera;
  /** How many of the nearest street lamps become real point lights at night. */
  lampLights: number;
  /** Lamp head positions, xyz triples. */
  lampHeads: Float32Array;
  /** Sun (by day) or moon (at night): direction towards the light. */
  sun: { direction: Vector3; color: Color; intensity: number };
  textures?: { rock?: Texture };
  /** Size of the baked facade and ground maps. */
  textureSize?: number;
}

export interface PhotoScene {
  scene: Scene;
  triangles: number;
  dispose(): void;
}

const STANDARD = MeshStandardMaterial.prototype.onBeforeCompile;
const KEEP = ['position', 'normal', 'uv', 'color', 'aPart'];

function clean<T extends Material>(m: T): T {
  m.onBeforeCompile = STANDARD;
  return m;
}

/** World-space copy of a geometry with only the attributes the path tracer reads. */
function worldGeometry(source: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const g = new BufferGeometry();
  for (const name of KEEP) {
    const a = source.getAttribute(name);
    if (a) g.setAttribute(name, a.clone());
  }
  if (source.index) g.setIndex(source.index.clone());
  g.applyMatrix4(matrix);
  return g;
}

function triangleCount(g: BufferGeometry) {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}

function setColor(g: BufferGeometry, c: Color) {
  const n = g.getAttribute('position').count;
  const prev = g.getAttribute('color');
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    out[i * 3] = c.r * (prev ? prev.getX(i) : 1);
    out[i * 3 + 1] = c.g * (prev ? prev.getY(i) : 1);
    out[i * 3 + 2] = c.b * (prev ? prev.getZ(i) : 1);
  }
  g.setAttribute('color', new BufferAttribute(out, 3));
}

/** One merged world-space geometry per group of instances (all of them by default). */
function expandInstances(mesh: InstancedMesh, groupOf: (i: number) => string = () => ''): Map<string, BufferGeometry> {
  const parts = new Map<string, BufferGeometry[]>();
  const m = new Matrix4();
  const c = new Color();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    const g = worldGeometry(mesh.geometry, m.premultiply(mesh.matrixWorld));
    if (mesh.instanceColor) {
      mesh.getColorAt(i, c);
      setColor(g, c);
    }
    const key = groupOf(i);
    if (!parts.has(key)) parts.set(key, []);
    parts.get(key)!.push(g);
  }
  const out = new Map<string, BufferGeometry>();
  for (const [key, list] of parts) {
    out.set(key, mergeGeometries(list)!);
    for (const g of list) g.dispose();
  }
  return out;
}

/** Skinned vertices in their current pose, in world space. */
function bakeSkinned(mesh: SkinnedMesh): BufferGeometry {
  const src = mesh.geometry;
  const n = src.getAttribute('position').count;
  const pos = new Float32Array(n * 3);
  const v = new Vector3();
  for (let i = 0; i < n; i++) {
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  for (const name of ['uv', 'color']) {
    const a = src.getAttribute(name);
    if (a) g.setAttribute(name, a.clone());
  }
  if (src.index) g.setIndex(src.index.clone());
  g.computeVertexNormals();
  return g;
}

interface Corner {
  p: Vector3;
  n: Vector3;
  u: number;
  v: number;
}

const lerp = (a: Corner, b: Corner, t: number): Corner => ({
  p: a.p.clone().lerp(b.p, t),
  n: a.n.clone().lerp(b.n, t).normalize(),
  u: a.u + (b.u - a.u) * t,
  v: a.v + (b.v - a.v) * t,
});

/** Keeps the part of a polygon where sign·(v − line) ≥ 0 (Sutherland–Hodgman against one line). */
function clip(poly: Corner[], line: number, sign: 1 | -1): Corner[] {
  const out: Corner[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = sign * (a.v - line);
    const db = sign * (b.v - line);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) out.push(lerp(a, b, da / (da - db)));
  }
  return out;
}

interface Bucket {
  pos: number[];
  nor: number[];
  uv: number[];
}

/** Splits facade walls at the first floor line and maps both parts into the baked atlases, per style. */
function bakeFacadeWalls(mesh: Mesh, buckets: Map<string, Bucket>) {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const uv = g.getAttribute('uv');
  const bld = g.getAttribute('aBuilding');
  const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
  const index = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
  const corner = (i: number): Corner => ({
    p: new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld),
    n: new Vector3().fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize(),
    u: uv.getX(i),
    v: uv.getY(i),
  });
  for (let t = 0; t < index.length; t += 3) {
    const i0 = index[t];
    const building = [bld.getX(i0), bld.getY(i0), bld.getZ(i0), bld.getW(i0)] as const;
    const style = Math.round(building[1]);
    const tri = [corner(i0), corner(index[t + 1]), corner(index[t + 2])];
    for (const ground of [true, false]) {
      const part = clip(tri, building[2], ground ? -1 : 1);
      if (part.length < 3) continue;
      const key = `${style}:${ground ? 'ground' : 'upper'}`;
      if (!buckets.has(key)) buckets.set(key, { pos: [], nor: [], uv: [] });
      const b = buckets.get(key)!;
      for (let k = 1; k + 1 < part.length; k++)
        for (const c of [part[0], part[k], part[k + 1]]) {
          b.pos.push(c.p.x, c.p.y, c.p.z);
          b.nor.push(c.n.x, c.n.y, c.n.z);
          b.uv.push(...facadeUV(c.u, c.v, building, ground));
        }
    }
  }
}

const TRIM_STONE: Color[] = [new Color(0.6, 0.535, 0.43), new Color(0.42, 0.42, 0.41), new Color(0.3, 0.26, 0.22)];

/** Trims and roofs: per-style stone colours as vertex colours; curtain-wall trims are steel. */
function bakeTrim(mesh: Mesh, roof: boolean): { stone: BufferGeometry; steel: BufferGeometry | null } {
  const g = worldGeometry(mesh.geometry, mesh.matrixWorld).toNonIndexed();
  const bld = mesh.geometry.getAttribute('aBuilding');
  const order = mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null;
  const n = g.getAttribute('position').count;
  const color = new Float32Array(n * 3);
  const steel: number[] = [];
  const stone: number[] = [];
  for (let t = 0; t < n; t += 3) {
    const src = order ? order[t] : t;
    const style = Math.round(bld.getY(src));
    const h = Math.sin(bld.getX(src) * 91.7) * 43758.5;
    const tint = h - Math.floor(h);
    const c = roof
      ? new Color(0.11, 0.105, 0.1).lerp(new Color(0.17, 0.16, 0.14), tint)
      : style < 3
        ? TRIM_STONE[style].clone()
        : new Color(0.32, 0.34, 0.36);
    for (let k = 0; k < 3; k++) color.set([c.r, c.g, c.b], (t + k) * 3);
    (style === 3 && !roof ? steel : stone).push(t, t + 1, t + 2);
  }
  g.setAttribute('color', new BufferAttribute(color, 3));
  const pick = (tris: number[]) => {
    if (tris.length === 0) return null;
    const part = g.clone();
    part.setIndex(tris);
    return part;
  };
  const out = { stone: pick(stone) ?? new BufferGeometry(), steel: pick(steel) };
  g.dispose();
  return out;
}

/** The triangles of one car part, as a non-indexed geometry (null if there are none). */
function splitByPart(source: BufferGeometry, part: number): BufferGeometry | null {
  const g = source.index ? source.toNonIndexed() : source;
  const parts = g.getAttribute('aPart');
  if (!parts) return null;
  const keep: number[] = [];
  for (let t = 0; t < parts.count; t += 3) if (Math.round(parts.getX(t)) === part) keep.push(t);
  if (keep.length === 0) return null;
  const out = new BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = g.getAttribute(name);
    if (!a) continue;
    const data = new Float32Array(keep.length * 3 * a.itemSize);
    keep.forEach((t, i) =>
      data.set((a.array as Float32Array).subarray(t * a.itemSize, (t + 3) * a.itemSize), i * 3 * a.itemSize),
    );
    out.setAttribute(name, new BufferAttribute(data, a.itemSize));
  }
  if (g !== source) g.dispose();
  return out;
}

function carPartMaterial(part: keyof typeof CAR_PART): MeshStandardMaterial {
  switch (part) {
    case 'paint':
      return new MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.38,
        metalness: 0.35,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
      });
    case 'glass':
      return new MeshStandardMaterial({ color: new Color(0.02, 0.025, 0.03), roughness: 0.05 });
    case 'tyre':
      return new MeshStandardMaterial({ color: new Color(0.028, 0.028, 0.028), roughness: 0.88 });
    case 'chrome':
      return new MeshStandardMaterial({ color: new Color(0.5, 0.5, 0.5), roughness: 0.3, metalness: 1 });
    case 'tail':
      return new MeshStandardMaterial({ color: new Color(0.35, 0.015, 0.01), roughness: 0.08 });
    case 'plate':
      return new MeshStandardMaterial({ color: new Color(0.78, 0.78, 0.74), roughness: 0.45, metalness: 0 });
    default:
      return new MeshStandardMaterial({ color: new Color(0.36, 0.38, 0.4), roughness: 0.08 });
  }
}

export function buildPhotoScene(sources: Object3D[], opts: PhotoSceneOptions): PhotoScene {
  const scene = new Scene();
  scene.name = 'PhotoScene';
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const size = opts.textureSize ?? 1024;
  const facadeMaps = new Map<number, { upper: BakedMaps; ground: BakedMaps }>();
  const buckets = new Map<string, Bucket>();
  let triangles = 0;

  const add = (geometry: BufferGeometry, material: Material, name: string) => {
    if (!geometry.getAttribute('position') || geometry.getAttribute('position').count === 0) return;
    const mesh = new Mesh(keep(geometry), material);
    mesh.name = name;
    scene.add(mesh);
    triangles += triangleCount(geometry);
  };
  const copy = (m: Material): Material => {
    if ((m as MeshBasicMaterial).isMeshBasicMaterial) {
      const b = m as MeshBasicMaterial;
      return keep(
        clean(new MeshStandardMaterial({ color: 0x000000, emissive: b.color, emissiveMap: b.map, roughness: 0.4 })),
      );
    }
    return keep(clean((m as MeshStandardMaterial).clone()));
  };
  const standardLike = (m: Material) =>
    (m as MeshStandardMaterial).isMeshStandardMaterial || (m as MeshBasicMaterial).isMeshBasicMaterial;

  for (const source of sources) {
    source.updateMatrixWorld(true);
    source.traverseVisible(o => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      // Level-of-detail halves (near/far trunks and cars) are often empty.
      if ((mesh as InstancedMesh).isInstancedMesh && (mesh as InstancedMesh).count === 0) return;
      const role = mesh.userData.photo as PhotoRole | undefined;
      const material = mesh.material as Material;
      if (role === 'skip' || Array.isArray(mesh.material)) return;
      if (role === 'facade') return bakeFacadeWalls(mesh, buckets);
      if (role === 'trim' || role === 'roof') {
        const { stone, steel } = bakeTrim(mesh, role === 'roof');
        add(stone, keep(new MeshStandardMaterial({ vertexColors: true, roughness: 0.88 })), `${mesh.name}:stone`);
        if (steel)
          add(
            steel,
            keep(new MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.75 })),
            `${mesh.name}:steel`,
          );
        return;
      }
      if (role === 'ground') {
        const island = opts.layout.islands.find(i => i.id === (mesh.userData.island as IslandId))!;
        const g = worldGeometry(mesh.geometry, mesh.matrixWorld);
        const p = g.getAttribute('position');
        const uv = new Float32Array(p.count * 2);
        for (let i = 0; i < p.count; i++) {
          uv[i * 2] = (p.getX(i) - (island.cx - island.radius)) / (island.radius * 2);
          uv[i * 2 + 1] = (p.getZ(i) - (island.cz - island.radius)) / (island.radius * 2);
        }
        g.setAttribute('uv', new BufferAttribute(uv, 2));
        const maps = bakeGround(opts.layout, island.id, size);
        owned.push(maps.map, maps.roughnessMap);
        add(
          g,
          keep(new MeshStandardMaterial({ map: maps.map, roughnessMap: maps.roughnessMap, roughness: 1 })),
          mesh.name,
        );
        return;
      }
      if (role === 'car') {
        // Car paint is one shader with per-vertex parts; the path tracer needs a material per part.
        const merged = (mesh as InstancedMesh).isInstancedMesh
          ? expandInstances(mesh as InstancedMesh).get('')!
          : worldGeometry(mesh.geometry, mesh.matrixWorld);
        if (!merged) return;
        for (const [name, part] of Object.entries(CAR_PART)) {
          const g = splitByPart(merged, part);
          if (g) add(g, carPartMaterial(name as keyof typeof CAR_PART), `${mesh.name}:${name}`);
        }
        merged.dispose();
        return;
      }
      if (role === 'rock') {
        const g = worldGeometry(mesh.geometry, mesh.matrixWorld);
        g.setAttribute('uv', new BufferAttribute(rockUVs(g, 1 / 18), 2));
        add(
          g,
          keep(new MeshStandardMaterial({ map: opts.textures?.rock ?? null, color: 0x9a9088, roughness: 0.92 })),
          mesh.name,
        );
        return;
      }
      if (!standardLike(material)) return;
      if ((mesh as SkinnedMesh).isSkinnedMesh) return add(bakeSkinned(mesh as SkinnedMesh), copy(material), mesh.name);
      if ((mesh as InstancedMesh).isInstancedMesh) {
        const inst = mesh as InstancedMesh;
        if ((material as MeshBasicMaterial).isMeshBasicMaterial && inst.instanceColor) {
          // Unlit instances glow in their own colour: one emissive mesh per colour.
          const c = new Color();
          const key = (i: number) => (inst.getColorAt(i, c), c.getHexString());
          for (const [hex, g] of expandInstances(inst, key)) {
            g.deleteAttribute('color');
            const m = copy(material) as MeshStandardMaterial;
            m.emissive.set(`#${hex}`);
            add(g, m, `${mesh.name}:${hex}`);
          }
          return;
        }
        const merged = expandInstances(inst).get('')!;
        const m = copy(material) as MeshStandardMaterial;
        if (inst.instanceColor) m.vertexColors = true;
        return add(merged, m, mesh.name);
      }
      add(worldGeometry(mesh.geometry, mesh.matrixWorld), copy(material), mesh.name);
    });
  }

  // Facade buckets become one mesh per style and storey band.
  for (const [key, b] of buckets) {
    const [styleIndex, band] = key.split(':');
    const style = Number(styleIndex);
    if (!facadeMaps.has(style))
      facadeMaps.set(
        style,
        bakeFacade(STYLE_IDS[style], { night: opts.night, litRatio: opts.litRatio, seed: 1 + style, size }),
      );
    const maps = facadeMaps.get(style)![band as 'upper' | 'ground'];
    owned.push(maps.map, maps.roughnessMap);
    if (maps.emissiveMap) owned.push(maps.emissiveMap);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
    const material = new MeshStandardMaterial({
      map: maps.map,
      roughnessMap: maps.roughnessMap,
      metalnessMap: maps.metalnessMap,
      roughness: 1,
      metalness: 1,
      emissiveMap: maps.emissiveMap,
      emissive: maps.emissiveMap ? 0xffffff : 0x000000,
      emissiveIntensity: maps.emissiveMap ? 2.5 : 0,
    });
    add(g, keep(material), `facade:${STYLE_IDS[style]}:${band}`);
  }

  // Sun or moon, and at night the street lamps nearest the camera.
  const sun = new DirectionalLight(opts.sun.color, opts.sun.intensity);
  sun.position.copy(opts.sun.direction).multiplyScalar(1000);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  if (opts.night && opts.lampLights > 0) {
    const eye = opts.camera.getWorldPosition(new Vector3());
    const heads: Vector3[] = [];
    for (let i = 0; i + 2 < opts.lampHeads.length; i += 3)
      heads.push(new Vector3(opts.lampHeads[i], opts.lampHeads[i + 1], opts.lampHeads[i + 2]));
    heads.sort((a, b) => a.distanceToSquared(eye) - b.distanceToSquared(eye));
    for (const p of heads.slice(0, opts.lampLights)) {
      const lamp = new PointLight(0xffc27a, 40, 28, 2);
      lamp.position.copy(p);
      scene.add(lamp);
    }
  }

  return {
    scene,
    triangles,
    dispose() {
      for (const o of owned) o.dispose();
      owned.length = 0;
    },
  };
}
