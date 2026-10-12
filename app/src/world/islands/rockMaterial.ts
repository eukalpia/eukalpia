import { MeshStandardMaterial, Vector3 } from 'three';
import type { TextureSet } from '../buildings/facadeMaterial';

/**
 * Whiteout triplanar normal blend (Ben Golus), mirrored from the shader so it can be tested.
 * tx, ty, tz are tangent-space normals sampled on the YZ, XZ and XY planes.
 */
export function whiteoutBlend(n: Vector3, tx: Vector3, ty: Vector3, tz: Vector3): Vector3 {
  const w = new Vector3(Math.abs(n.x) ** 4, Math.abs(n.y) ** 4, Math.abs(n.z) ** 4);
  w.divideScalar(w.x + w.y + w.z);
  const bx = new Vector3(tx.x + n.z, tx.y + n.y, Math.abs(tx.z) * n.x);
  const by = new Vector3(ty.x + n.x, ty.y + n.z, Math.abs(ty.z) * n.y);
  const bz = new Vector3(tz.x + n.x, tz.y + n.y, Math.abs(tz.z) * n.z);
  return new Vector3(bx.z, bx.y, bx.x)
    .multiplyScalar(w.x)
    .add(new Vector3(by.x, by.z, by.y).multiplyScalar(w.y))
    .add(bz.multiplyScalar(w.z))
    .normalize();
}

/** Triplanar rock with depth darkening, strata tint and moss on ledges. */
export function createRockMaterial(
  textures: TextureSet,
  opts: { tint?: number; topY?: number } = {},
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  m.name = 'Rock';
  const tint = opts.tint ?? 1;
  m.onBeforeCompile = shader => {
    shader.uniforms.tRockDiff = { value: textures.map };
    shader.uniforms.tRockNorm = { value: textures.normalMap };
    shader.uniforms.tRockArm = { value: textures.armMap };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRWorld;\nvarying vec3 vRNormal;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvRWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tRockDiff;
        uniform sampler2D tRockNorm;
        uniform sampler2D tRockArm;
        varying vec3 vRWorld;
        varying vec3 vRNormal;
        float rHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        float rNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rHash(i), rHash(i + vec2(1, 0)), f.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 rN = normalize(vRNormal);
        vec3 rW = pow(abs(rN), vec3(4.0));
        rW /= rW.x + rW.y + rW.z;
        vec3 rP = vRWorld / 18.0;
        vec3 rCol = texture2D(tRockDiff, rP.zy).rgb * rW.x + texture2D(tRockDiff, rP.xz).rgb * rW.y + texture2D(tRockDiff, rP.xy).rgb * rW.z;
        vec3 rArm = texture2D(tRockArm, rP.zy).rgb * rW.x + texture2D(tRockArm, rP.xz).rgb * rW.y + texture2D(tRockArm, rP.xy).rgb * rW.z;
        // Second, larger scale breaks up tiling.
        vec3 rP2 = vRWorld / 71.0;
        vec3 rCol2 = texture2D(tRockDiff, rP2.zy).rgb * rW.x + texture2D(tRockDiff, rP2.xz).rgb * rW.y + texture2D(tRockDiff, rP2.xy).rgb * rW.z;
        rCol = mix(rCol, rCol2, 0.35);
        float depthBelow = clamp((${(opts.topY ?? 0).toFixed(1)} - vRWorld.y) / 260.0, 0.0, 1.0);
        float strata = rNoise(vec2(vRWorld.y * 0.18, 0.5)) * 0.5 + rNoise(vec2(vRWorld.y * 0.9, 3.0)) * 0.5;
        rCol *= mix(vec3(0.82, 0.74, 0.64), vec3(0.5, 0.47, 0.44), strata) * mix(1.0, 0.5, depthBelow) * ${tint.toFixed(3)};
        float moss = smoothstep(0.55, 0.85, rN.y) * smoothstep(0.35, 0.65, rNoise(vRWorld.xz * 0.12));
        rCol = mix(rCol, vec3(0.05, 0.075, 0.028), moss * 0.85);
        diffuseColor.rgb = rCol;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.78, 1.0, rArm.g);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 tx = texture2D(tRockNorm, rP.zy).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(tRockNorm, rP.xz).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(tRockNorm, rP.xy).xyz * 2.0 - 1.0;
          // Whiteout-style blend of three tangent-space normals.
          tx = vec3(tx.xy + rN.zy, abs(tx.z) * rN.x);
          ty = vec3(ty.xy + rN.xz, abs(ty.z) * rN.y);
          tz = vec3(tz.xy + rN.xy, abs(tz.z) * rN.z);
          vec3 nWorld = normalize(tx.zyx * rW.x + ty.xzy * rW.y + tz.xyz * rW.z);
          normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
        }`,
      )
      .replace(
        '#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(0.6, 1.0, rArm.r);',
      );
  };
  m.customProgramCacheKey = () => `rock-${tint}-${opts.topY ?? 0}`;
  return m;
}
