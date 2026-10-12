import {
  BufferAttribute,
  BufferGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  type Material,
} from 'three';
import { mulberry32, range } from '../rng';

/** Trunks closer than this (m) get the detailed geometry. */
export const TREE_LOD_NEAR = 70;

const DETAIL = {
  near: { sides: 12, rings: 9, boughs: 5, boughSides: 7, boughRings: 4 },
  far: { sides: 6, rings: 4, boughs: 3, boughSides: 4, boughRings: 2 },
} as const;

/** A tube along a polyline with per-ring radius, 12 sides; rings are oriented along the path. */
function tube(path: Vector3[], radii: number[], sides: number, pos: number[], idx: number[], jitter: () => number) {
  const base = pos.length / 3;
  const up = new Vector3(0, 1, 0);
  const t = new Vector3();
  const a = new Vector3();
  const b = new Vector3();
  path.forEach((p, i) => {
    t.subVectors(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]).normalize();
    a.crossVectors(Math.abs(t.y) > 0.99 ? new Vector3(1, 0, 0) : up, t).normalize();
    b.crossVectors(t, a);
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2;
      const r = radii[i] * (1 + jitter());
      pos.push(
        p.x + (a.x * Math.cos(ang) + b.x * Math.sin(ang)) * r,
        p.y + (a.y * Math.cos(ang) + b.y * Math.sin(ang)) * r,
        p.z + (a.z * Math.cos(ang) + b.z * Math.sin(ang)) * r,
      );
    }
  });
  for (let i = 0; i < path.length - 1; i++)
    for (let k = 0; k < sides; k++) {
      const k1 = (k + 1) % sides;
      const r0 = base + i * sides;
      const r1 = base + (i + 1) * sides;
      idx.push(r0 + k, r1 + k, r1 + k1, r0 + k, r1 + k1, r0 + k1);
    }
}

/**
 * Trunk and boughs of a street tree: a 12-sided, slightly bent trunk with a root flare and an
 * irregular section, and five boughs curving up into the crown.
 */
export function trunkGeometry(
  height: number,
  radius: number,
  seed: number,
  lod: 'near' | 'far' = 'near',
): BufferGeometry {
  const d = DETAIL[lod];
  const rng = mulberry32(seed);
  const pos: number[] = [];
  const idx: number[] = [];
  const lean = new Vector3(range(rng, -0.15, 0.15), 0, range(rng, -0.15, 0.15));
  const trunkTop = height * 0.6;
  const rings = d.rings;
  const path: Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    const y = s * trunkTop;
    path.push(new Vector3(lean.x * s * s, y, lean.z * s * s));
    // Roots flare out over the first 40 cm; the trunk tapers to 60 % at the crown.
    const flare = 1 + 0.7 * Math.exp(-y / 0.18);
    radii.push(radius * flare * (1 - 0.4 * s));
  }
  tube(path, radii, d.sides, pos, idx, () => range(rng, -0.06, 0.06));

  const boughs = d.boughs;
  for (let j = 0; j < boughs; j++) {
    const ang = (j / boughs) * Math.PI * 2 + range(rng, -0.4, 0.4);
    const out = new Vector3(Math.cos(ang), 0, Math.sin(ang));
    const start = path[Math.round(rings * 0.78)].clone();
    const len = range(rng, 1.4, 2.2);
    const bp: Vector3[] = [];
    const br: number[] = [];
    for (let i = 0; i <= d.boughRings; i++) {
      const s = i / d.boughRings;
      bp.push(
        start
          .clone()
          .addScaledVector(out, len * s * 0.8)
          .add(new Vector3(0, len * (0.35 * s + 0.45 * s * s), 0)),
      );
      br.push(radius * 0.42 * (1 - 0.75 * s));
    }
    tube(bp, br, d.boughSides, pos, idx, () => 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface TrunkLod {
  near: InstancedMesh;
  far: InstancedMesh;
  /** Re-sorts trunks into near and far around the camera (skips moves under 2 m). */
  update(camera: Vector3): void;
}

/** Trunks of one tree variant split into a detailed near set and a cheap far set. */
export function createTrunkLod(
  near: BufferGeometry,
  far: BufferGeometry,
  material: Material,
  matrices: readonly Matrix4[],
  opts: { name: string; castShadow: boolean },
): TrunkLod {
  const make = (g: BufferGeometry, lod: string) => {
    const mesh = new InstancedMesh(g, material, Math.max(1, matrices.length));
    mesh.count = 0;
    mesh.name = `${opts.name}:${lod}`;
    mesh.castShadow = opts.castShadow;
    mesh.receiveShadow = true;
    return mesh;
  };
  const lod = { near: make(near, 'near'), far: make(far, 'far') };
  const p = new Vector3();
  const last = new Vector3(Infinity, 0, 0);
  return {
    ...lod,
    update(camera) {
      if (camera.distanceToSquared(last) < 4) return;
      last.copy(camera);
      lod.near.count = lod.far.count = 0;
      for (const m of matrices) {
        const mesh = p.setFromMatrixPosition(m).distanceTo(camera) < TREE_LOD_NEAR ? lod.near : lod.far;
        mesh.setMatrixAt(mesh.count++, m);
      }
      for (const mesh of [lod.near, lod.far]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
  };
}

/** Grey-brown bark with vertical fissures, evaluated on the tree's own (instance-local) position. */
export function createBarkMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0x2a221c, roughness: 0.92 });
  m.color.setRGB(0.12, 0.1, 0.085);
  m.name = 'Bark';
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBark;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBark = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vBark;
        /*bark*/
        float bHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float bNoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(bHash(i), bHash(i + vec3(1,0,0)), f.x), mix(bHash(i + vec3(0,1,0)), bHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(bHash(i + vec3(0,0,1)), bHash(i + vec3(1,0,1)), f.x), mix(bHash(i + vec3(0,1,1)), bHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Plates of bark split by vertical fissures; lichen on the shaded side.
        float bFissure = smoothstep(0.52, 0.72, bNoise(vBark * vec3(28.0, 3.5, 28.0)));
        float bPlate = bNoise(vBark * vec3(9.0, 2.0, 9.0));
        float bH = -bFissure * 0.006 + bPlate * 0.002;
        diffuseColor.rgb *= mix(1.15, 0.45, bFissure) * (0.85 + 0.3 * bPlate);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.17, 0.1), smoothstep(0.62, 0.8, bNoise(vBark * 6.0 + 3.0)) * 0.35);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 bPos = -vViewPosition;
          vec3 sx = dFdx(bPos); vec3 sy = dFdy(bPos);
          float dhx = dFdx(bH); float dhy = dFdy(bH);
          vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1);
          normal = normalize(abs(det) * normal - sign(det) * (dhx * r1 + dhy * r2));
        }`,
      );
  };
  m.customProgramCacheKey = () => 'bark';
  return m;
}

/** Leaves this close to the camera dissolve: inside a crown, or between the third-person camera and UR-01. */
export const LEAF_FADE = { near: 1, far: 3 };

/** How much of a leaf survives at this distance from the camera (the shader's smoothstep). */
export function leafCoverAt(distance: number): number {
  const t = Math.min(1, Math.max(0, (distance - LEAF_FADE.near) / (LEAF_FADE.far - LEAF_FADE.near)));
  return t * t * (3 - 2 * t);
}

/** Dithers leaves away near the camera, after whatever hooks the material already has (the sun's cascades). */
export function fadeNearCamera(m: Material): void {
  const earlier = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    earlier(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <alphatest_fragment>',
      `#include <alphatest_fragment>
      /*leaves:near-fade*/
      {
        float cover = smoothstep(${LEAF_FADE.near.toFixed(2)}, ${LEAF_FADE.far.toFixed(2)}, length(vViewPosition));
        float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (dither >= cover) discard;
      }`,
    );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}|near-fade`;
}
