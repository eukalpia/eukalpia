import {
  CircleGeometry,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  RedFormat,
  RGBAFormat,
  type BufferGeometry,
  type Material,
} from 'three';
import type { SunRig } from '../engine/lighting/sun';
import { TIER_SETTINGS, type QualityTier } from '../engine/quality';
import type { TextureSet } from './buildings/facadeMaterial';
import { createGroundMaterial, type GroundMaterial } from './ground/groundMaterial';
import { lampPositions, rasterizeGround, rasterizeLampGlow } from './ground/groundMask';
import { buildBridge } from './islands/bridge';
import { buildIslandRock, buildRoots } from './islands/island';
import { createRockMaterial } from './islands/rockMaterial';
import { buildWaterfalls, createWaterfallMaterial } from './islands/waterfall';
import type { CityLayout } from './layout';
import { fork, mulberry32 } from './rng';
import { planFurniture, type FurniturePlan } from './street/furniture';
import { createStreetMeshes, type StreetMeshes } from './street/meshes';

export interface Terrain {
  group: Group;
  furniture: FurniturePlan;
  street: StreetMeshes;
  setNight(night: boolean): void;
  update(seconds: number): void;
  dispose(): void;
}

export function createTerrain(
  layout: CityLayout,
  ctx: { tier: QualityTier; sun: SunRig; textures: { rock: TextureSet; concrete: TextureSet } },
): Terrain {
  const group = new Group();
  group.name = 'Terrain';
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: DataTexture[] = [];
  const grounds: GroundMaterial[] = [];
  const root = mulberry32(layout.seed ^ 0x51a7d);
  const lamps = lampPositions(layout);
  const waterfallMaterial = createWaterfallMaterial();
  materials.push(waterfallMaterial);

  layout.islands.forEach((island, k) => {
    const rng = fork(root, k + 1);
    const rockMaterial = createRockMaterial(ctx.textures.rock, { topY: island.topY });
    const rootMaterial = createRockMaterial(ctx.textures.rock, { topY: island.topY, tint: 0.55 });
    ctx.sun.setupMaterial(rockMaterial);
    ctx.sun.setupMaterial(rootMaterial);
    materials.push(rockMaterial, rootMaterial);

    const rock = new Mesh(buildIslandRock(island, rng), rockMaterial);
    rock.castShadow = TIER_SETTINGS[ctx.tier].shadowCasters.has('rock');
    rock.receiveShadow = true;
    rock.name = `rock:${island.id}`;
    const roots = new Mesh(buildRoots(island, rng), rootMaterial);
    roots.castShadow = TIER_SETTINGS[ctx.tier].shadowCasters.has('rock');
    roots.receiveShadow = true;
    roots.name = `roots:${island.id}`;

    const size = island.id === 'main' ? (ctx.tier === 'low' ? 1024 : 2048) : 512;
    const mask = new DataTexture(rasterizeGround(layout, island.id, size), size, size, RGBAFormat);
    const glow = new DataTexture(rasterizeLampGlow(island, lamps, size / 2), size / 2, size / 2, RedFormat);
    for (const t of [mask, glow]) {
      t.generateMipmaps = true;
      t.minFilter = LinearMipmapLinearFilter;
      t.magFilter = LinearFilter;
      t.needsUpdate = true;
      textures.push(t);
    }
    const groundMaterial = createGroundMaterial(mask, glow, island, {
      concrete: ctx.textures.concrete.map,
      concreteNormal: ctx.textures.concrete.normalMap,
    });
    ctx.sun.setupMaterial(groundMaterial);
    materials.push(groundMaterial);
    grounds.push(groundMaterial);
    const ground = new Mesh(
      new CircleGeometry(island.radius, 160).rotateX(-Math.PI / 2).translate(island.cx, island.topY, island.cz),
      groundMaterial,
    );
    ground.receiveShadow = true;
    ground.name = `ground:${island.id}`;

    const falls = buildWaterfalls(island, rng, layout.bridges);
    const waterfalls = new Mesh(falls.geometry, waterfallMaterial);
    waterfalls.renderOrder = 5;
    waterfalls.name = `waterfalls:${island.id}`;

    geometries.push(rock.geometry, roots.geometry, ground.geometry, falls.geometry);
    group.add(rock, roots, ground, waterfalls);
  });

  const steel = new MeshStandardMaterial({ color: 0x3e4349, roughness: 0.42, metalness: 0.75 });
  ctx.sun.setupMaterial(steel);
  materials.push(steel);
  for (const b of layout.bridges) {
    const bridge = new Mesh(buildBridge(b), steel);
    bridge.castShadow = bridge.receiveShadow = true;
    bridge.name = `bridge:${b.to}`;
    geometries.push(bridge.geometry);
    group.add(bridge);
  }

  const furniture = planFurniture(layout, ctx.tier);
  const street = createStreetMeshes(furniture, { sun: ctx.sun, tier: ctx.tier });
  group.add(street.group);

  return {
    group,
    furniture,
    street,
    setNight(night) {
      for (const g of grounds) g.uniforms.uNight.value = night ? 1 : 0;
      street.setNight(night);
      waterfallMaterial.uniforms.uLight.value = night ? 0.12 : 1;
    },
    update(seconds) {
      waterfallMaterial.uniforms.uTime.value = seconds;
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const mat of materials) mat.dispose();
      for (const t of textures) t.dispose();
      street.dispose();
    },
  };
}
