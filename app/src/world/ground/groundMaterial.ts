import { MeshStandardMaterial, Vector2, type DataTexture, type Texture } from 'three';
import type { Island } from '../layout';

export type GroundMaterial = MeshStandardMaterial & { uniforms: { uNight: { value: number } } };

/** Streets, paving, lawns and markings driven by the island's ground mask. */
export function createGroundMaterial(
  mask: DataTexture,
  glow: DataTexture,
  island: Island,
  detail: { concrete: Texture; concreteNormal: Texture },
): GroundMaterial {
  const m = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 }) as GroundMaterial;
  m.name = 'Ground';
  m.uniforms = { uNight: { value: 0 } };
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, m.uniforms, {
      tMask: { value: mask },
      tGlow: { value: glow },
      tDetail: { value: detail.concrete },
      tDetailNorm: { value: detail.concreteNormal },
      uOrigin: { value: new Vector2(island.cx - island.radius, island.cz - island.radius) },
      uSpan: { value: island.radius * 2 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvGWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tMask;
        uniform sampler2D tGlow;
        uniform sampler2D tDetail;
        uniform sampler2D tDetailNorm;
        uniform vec2 uOrigin;
        uniform float uSpan;
        uniform float uNight;
        varying vec3 vGWorld;
        float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float gNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec2 gUv = (vGWorld.xz - uOrigin) / uSpan;
        vec4 gMask = texture2D(tMask, gUv);
        vec2 gP = vGWorld.xz;
        vec3 gDetail = mix(vec3(1.0), texture2D(tDetail, gP / 3.0).rgb / vec3(0.034, 0.035, 0.042), 0.35);
        float n1 = gNoise(gP * 0.35);
        float n2 = gNoise(gP * 3.1);

        vec3 asphalt = vec3(0.052, 0.054, 0.058) * (0.8 + 0.35 * n1) * (0.85 + 0.3 * n2) * gDetail;
        vec2 tile = fract(gP / 0.6);
        float joint = 1.0 - smoothstep(0.0, 0.05, min(min(tile.x, 1.0 - tile.x), min(tile.y, 1.0 - tile.y)));
        vec3 paving = vec3(0.2, 0.195, 0.185) * (0.9 + 0.2 * gHash(floor(gP / 0.6))) * gDetail * (1.0 - joint * 0.45);
        vec3 grass = vec3(0.045, 0.072, 0.028) * (0.7 + 0.6 * n1) * (0.85 + 0.3 * n2);
        // Kerb: the soft edge between road and paving.
        float kerb = smoothstep(0.15, 0.5, gMask.r) * (1.0 - smoothstep(0.5, 0.85, gMask.r));

        vec3 col = paving;
        float rough = 0.82;
        col = mix(col, grass, gMask.b);
        rough = mix(rough, 0.95, gMask.b);
        col = mix(col, asphalt, gMask.r);
        // Wet asphalt at night, with puddles.
        float puddle = smoothstep(0.55, 0.7, gNoise(gP * 0.08) * 0.7 + n2 * 0.3);
        float asphaltRough = mix(0.88, mix(0.42, 0.08, puddle), uNight);
        rough = mix(rough, asphaltRough, gMask.r);
        col = mix(col, vec3(0.42, 0.41, 0.39) * gDetail, kerb);
        // Manholes on the roadway.
        vec2 cell = floor(gP / 9.0);
        vec2 local = gP - (cell + 0.5) * 9.0;
        float manhole = step(gHash(cell + 3.7), 0.06) * (1.0 - smoothstep(0.33, 0.37, length(local))) * step(0.99, gMask.r);
        col = mix(col, vec3(0.03), manhole);
        // Paint.
        vec3 paint = gMask.a > 0.75 ? vec3(0.62, 0.62, 0.6) : vec3(0.55, 0.38, 0.08);
        float painted = smoothstep(0.3, 0.55, gMask.a) * (0.75 + 0.25 * n2);
        col = mix(col, paint, painted);
        rough = mix(rough, 0.6, painted);
        // Outside the island square nothing is drawn; the disc mesh covers only the island anyway.
        diffuseColor.rgb = col;
        float gRough = rough;
        float gGlow = texture2D(tGlow, gUv).r;`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.62, 0.32) * gGlow * gGlow * uNight * diffuseColor.rgb * 4.0;',
      );
  };
  m.customProgramCacheKey = () => 'ground';
  return m;
}
