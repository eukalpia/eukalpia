import {
  BufferGeometry,
  CubeCamera,
  Group,
  HalfFloatType,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLCubeRenderTarget,
  type Scene,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import type { District } from '../content/districts';
import type { QualityTier } from '../engine/quality';
import type { SunRig } from '../engine/lighting/sun';
import { buildCity, MeshBuilder, type PropInstance } from './buildings/geometry';
import {
  createFacadeMaterial,
  type FacadeMaterial,
  type FacadeTextures,
  type TextureSet,
} from './buildings/facadeMaterial';
import type { CityLayout } from './layout';

export interface WorldTextures extends FacadeTextures {
  rock: TextureSet;
}

/** Loads the CC0 PBR sets that ship in public/. */
export async function loadWorldTextures(renderer: WebGLRenderer, base: string): Promise<WorldTextures> {
  const loader = new TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const load = async (path: string, color: boolean): Promise<Texture> => {
    const t = await loader.loadAsync(base + path);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = anisotropy;
    if (color) t.colorSpace = SRGBColorSpace;
    return t;
  };
  const set = async (diff: string, normal: string, arm: string): Promise<TextureSet> => {
    const [map, normalMap, armMap] = await Promise.all([load(diff, true), load(normal, false), load(arm, false)]);
    return { map, normalMap, armMap };
  };
  const kit = 'models/factory-kit/textures/modular_factory_facade_brick';
  const [concrete, steel, brick, rock] = await Promise.all([
    set('materials/concrete-diff.jpg', 'materials/concrete-normal.jpg', 'materials/concrete-arm.jpg'),
    set('materials/steel-diff.jpg', 'materials/steel-normal.jpg', 'materials/steel-arm.jpg'),
    set(`${kit}_diff_1k.jpg`, `${kit}_nor_gl_1k.jpg`, `${kit}_arm_1k.jpg`),
    set('materials/rock-color.jpg', 'materials/rock-normal.jpg', 'materials/rock-arm.jpg'),
  ]);
  return { concrete, steel, brick, rock };
}

/** Cornices, belts and crowns take the building's stone; curtain-wall trims are steel. */
function createTrimMaterial(textures: FacadeTextures, roof: boolean): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  m.name = roof ? 'Roof' : 'Trim';
  m.onBeforeCompile = shader => {
    shader.uniforms.tDiff = { value: textures.concrete.map };
    shader.uniforms.tNorm = { value: textures.concrete.normalMap };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aBuilding;\nvarying vec4 vTBuilding;\nvarying vec2 vTUv;',
      )
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTBuilding = aBuilding;\nvTUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tDiff;\nuniform sampler2D tNorm;\nvarying vec4 vTBuilding;\nvarying vec2 vTUv;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 tTex = mix(vec3(1.0), texture2D(tDiff, vTUv / 4.0).rgb / vec3(0.034, 0.035, 0.042), 0.45);
        float tStyle = vTBuilding.y;
        float tTint = fract(sin(vTBuilding.x * 91.7) * 43758.5);
        vec3 tCol = tStyle < 0.5 ? tTex * mix(vec3(0.56, 0.5, 0.4), vec3(0.64, 0.57, 0.46), tTint)
          : tStyle < 1.5 ? tTex * vec3(0.42, 0.42, 0.41)
          : tStyle < 2.5 ? tTex * vec3(0.3, 0.26, 0.22)
          : vec3(0.32, 0.34, 0.36);
        ${roof ? 'tCol = tTex * mix(vec3(0.11, 0.105, 0.1), vec3(0.17, 0.16, 0.14), tTint);' : ''}
        diffuseColor.rgb = tCol;
        float tMetal = (!${roof} && tStyle > 2.5) ? 0.75 : 0.0;`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = tMetal;')
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = tMetal > 0.5 ? 0.35 : 0.88;',
      );
  };
  m.customProgramCacheKey = () => (roof ? 'roof' : 'trim');
  return m;
}

function propGeometry(kind: PropInstance['kind']): BufferGeometry {
  const b = new MeshBuilder();
  if (kind === 'hvac') {
    b.box(-1.6, 0, -1.1, 1.6, 1.7, 1.1);
    b.cylinder(-0.75, 0, 1.7, 1.95, 0.6, 0.6, 10);
    b.cylinder(0.75, 0, 1.7, 1.95, 0.6, 0.6, 10);
  } else if (kind === 'watertower') {
    for (const [x, z] of [
      [-1.5, -1.5],
      [1.5, -1.5],
      [1.5, 1.5],
      [-1.5, 1.5],
    ])
      b.box(x - 0.12, 0, z - 0.12, x + 0.12, 4.2, z + 0.12);
    b.box(-1.9, 4.0, -1.9, 1.9, 4.25, 1.9, true);
    b.cylinder(0, 0, 4.25, 8.6, 2.1, 2.1, 16);
    b.cylinder(0, 0, 8.6, 10.2, 2.25, 0.15, 16);
  } else if (kind === 'antenna') {
    b.box(-0.4, 0, -0.4, 0.4, 0.5, 0.4);
    b.cylinder(0, 0, 0.5, 9, 0.09, 0.05, 6);
  } else {
    b.box(-1.8, 0, -1.5, 1.8, 3.1, 1.5);
    b.box(-2.0, 3.1, -1.7, 2.0, 3.3, 1.7, true);
  }
  return b.build();
}

export interface CityMeshes {
  group: Group;
  facade: FacadeMaterial;
  setNight(night: boolean, litRatio: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createCityMeshes(
  layout: CityLayout,
  districts: readonly District[],
  ctx: { tier: QualityTier; sun: SunRig; textures: FacadeTextures },
): CityMeshes {
  const group = new Group();
  group.name = 'City';
  const city = buildCity(layout, districts);
  const facade = createFacadeMaterial({ tier: ctx.tier, textures: ctx.textures });
  const trim = createTrimMaterial(ctx.textures, false);
  const roof = createTrimMaterial(ctx.textures, true);
  for (const m of [facade, trim, roof]) ctx.sun.setupMaterial(m);

  const geometries: BufferGeometry[] = [];
  for (const chunk of city.chunks) {
    for (const [geometry, material] of [
      [chunk.walls, facade],
      [chunk.trims, trim],
      [chunk.roofs, roof],
    ] as const) {
      if (!geometry.index || geometry.index.count === 0) continue;
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `${chunk.key}:${material.name}`;
      group.add(mesh);
      geometries.push(geometry);
    }
  }

  const propMaterial = new MeshStandardMaterial({ color: 0x8c8e90, roughness: 0.55, metalness: 0.55 });
  const tankMaterial = new MeshStandardMaterial({ color: 0x5a4636, roughness: 0.85, metalness: 0.05 });
  const beaconMaterial = new MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: 0 });
  for (const m of [propMaterial, tankMaterial]) ctx.sun.setupMaterial(m);
  const matrix = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const scale = new Vector3();
  for (const kind of ['hvac', 'watertower', 'antenna', 'stairhouse'] as const) {
    const items = city.props.filter(p => p.kind === kind);
    if (items.length === 0) continue;
    const geometry = propGeometry(kind);
    geometries.push(geometry);
    const mesh = new InstancedMesh(geometry, kind === 'watertower' ? tankMaterial : propMaterial, items.length);
    items.forEach((p, i) => {
      matrix.compose(pos.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rotY), scale.setScalar(p.scale));
      mesh.setMatrixAt(i, matrix);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `props:${kind}`;
    mesh.computeBoundingSphere();
    group.add(mesh);
    if (kind === 'antenna') {
      const beaconGeometry = new MeshBuilder();
      beaconGeometry.box(-0.18, 8.9, -0.18, 0.18, 9.25, 0.18, true);
      const g = beaconGeometry.build();
      geometries.push(g);
      const beacons = new InstancedMesh(g, beaconMaterial, items.length);
      items.forEach((p, i) => {
        matrix.compose(pos.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rotY), scale.setScalar(p.scale));
        beacons.setMatrixAt(i, matrix);
      });
      beacons.name = 'props:beacons';
      beacons.computeBoundingSphere();
      group.add(beacons);
    }
  }

  let time = 0;
  let night = false;
  return {
    group,
    facade,
    setNight(isNight, litRatio) {
      night = isNight;
      facade.uniforms.uNight.value = isNight ? 1 : 0;
      facade.uniforms.uLitRatio.value = litRatio;
    },
    update(dt) {
      time += dt;
      facade.uniforms.uTime.value = time;
      // Aircraft warning lights blink once a second at night.
      beaconMaterial.emissiveIntensity = night ? (Math.sin(time * Math.PI * 2) > 0.2 ? 30 : 0.5) : 0;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of [facade, trim, roof, propMaterial, tankMaterial, beaconMaterial]) m.dispose();
    },
  };
}

/** Renders the city into a cube map once so that glass reflects the actual skyline, not just the sky. */
export function captureCityReflection(
  renderer: WebGLRenderer,
  scene: Scene,
  at: Vector3,
): { texture: Texture; dispose(): void } {
  const cubeTarget = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
  const camera = new CubeCamera(2, 6000, cubeTarget);
  camera.position.copy(at);
  camera.update(renderer, scene);
  const pmrem = new PMREMGenerator(renderer);
  const target: WebGLRenderTarget = pmrem.fromCubemap(cubeTarget.texture);
  pmrem.dispose();
  cubeTarget.dispose();
  return {
    texture: target.texture,
    dispose: () => target.dispose(),
  };
}
