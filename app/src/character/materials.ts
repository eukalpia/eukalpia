import {
  Color,
  Matrix4,
  Vector3,
  type Material,
  type MeshPhysicalMaterial,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { boneKey } from './model';
import type { QualityTier } from '../engine/quality';

/** The ten materials of the UR-01 GLB ("UR01 / fabric", "UR01 / glass.001" …). */
export const UR01_MATERIALS = [
  'ceramic',
  'copper',
  'darkmetal',
  'fabric',
  'glass',
  'leather',
  'lining',
  'metal',
  'rubber',
  'seam',
] as const;
type Ur01Material = (typeof UR01_MATERIALS)[number];

/** Solid (3D) patterns evaluated on the bind-pose position, in metres. */
const PATTERN = { none: 0, wool: 1, weave: 2, grain: 3, brushed: 4, ceramic: 5, rubber: 6 } as const;

interface Look {
  /** Linear albedo. */
  color: [number, number, number];
  roughness: number;
  metalness: number;
  sheen?: number;
  sheenColor?: [number, number, number];
  sheenRoughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  envMapIntensity?: number;
  pattern: keyof typeof PATTERN;
}

// Physically plausible values: black wool is ~4 % albedo, not 0.2 %; ivory ceramic ~75 %.
const LOOKS: Record<Ur01Material, Look> = {
  fabric: {
    color: [0.021, 0.022, 0.024],
    roughness: 0.9,
    metalness: 0,
    sheen: 1,
    sheenColor: [0.04, 0.04, 0.043],
    sheenRoughness: 0.55,
    pattern: 'wool',
  },
  lining: {
    color: [0.07, 0.064, 0.058],
    roughness: 0.82,
    metalness: 0,
    sheen: 0.7,
    sheenColor: [0.09, 0.085, 0.08],
    sheenRoughness: 0.5,
    pattern: 'weave',
  },
  leather: {
    color: [0.045, 0.032, 0.024],
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.4,
    pattern: 'grain',
  },
  ceramic: {
    color: [0.74, 0.73, 0.69],
    roughness: 0.32,
    metalness: 0,
    clearcoat: 0.65,
    clearcoatRoughness: 0.1,
    pattern: 'ceramic',
  },
  copper: { color: [0.93, 0.62, 0.52], roughness: 0.36, metalness: 1, pattern: 'brushed' },
  metal: { color: [0.6, 0.6, 0.58], roughness: 0.3, metalness: 1, pattern: 'brushed' },
  darkmetal: { color: [0.11, 0.11, 0.12], roughness: 0.42, metalness: 1, pattern: 'brushed' },
  rubber: { color: [0.022, 0.022, 0.023], roughness: 0.78, metalness: 0, pattern: 'rubber' },
  seam: { color: [0.025, 0.025, 0.026], roughness: 0.7, metalness: 0, pattern: 'rubber' },
  glass: {
    color: [0.008, 0.011, 0.014],
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.6,
    pattern: 'none',
  },
};

const VERTEX_DECL = /* glsl */ `
varying vec3 vUrBind;
`;
const VERTEX_BODY = /* glsl */ `
/*ur01:bind*/
vUrBind = position;
`;

const FRAGMENT_DECL = /* glsl */ `
varying vec3 vUrBind;
/*ur01:relief*/
float urHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float urNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(urHash(i), urHash(i + vec3(1, 0, 0)), f.x), mix(urHash(i + vec3(0, 1, 0)), urHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(urHash(i + vec3(0, 0, 1)), urHash(i + vec3(1, 0, 1)), f.x), mix(urHash(i + vec3(0, 1, 1)), urHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Fades a band of period P (metres) out before it aliases: fw is the pixel footprint in metres.
float urBand(float P, float fw) { return 1.0 - smoothstep(P * 0.25, P * 0.6, fw); }

// Height (metres), and a 0..1 tone used for colour and roughness variation.
vec2 urRelief(vec3 p, float fw) {
  float h = 0.0;
  float t = 0.5;
#if UR_PATTERN == 1
  // Wool twill: diagonal ribs every 3 mm, slubs and fuzz at 1–4 cm.
  float rib = sin((p.x * 0.7 + p.y + p.z * 0.7) * 2094.0);
  float slub = urNoise(p * vec3(60.0, 25.0, 60.0));
  float fuzz = urNoise(p * 260.0);
  h = rib * 0.00012 * urBand(0.003, fw) + (slub - 0.5) * 0.0006 * urBand(0.03, fw) + (fuzz - 0.5) * 0.00025 * urBand(0.008, fw);
  t = 0.55 * slub + 0.45 * fuzz;
#elif UR_PATTERN == 2
  float w = sin(p.x * 3141.0) * sin(p.y * 3141.0);
  h = w * 0.00008 * urBand(0.002, fw) + (urNoise(p * 120.0) - 0.5) * 0.0002 * urBand(0.015, fw);
  t = urNoise(p * 120.0);
#elif UR_PATTERN == 3
  // Leather: pebbled grain and soft creases.
  float pebble = urNoise(p * 700.0);
  float crease = urNoise(p * vec3(30.0, 90.0, 30.0));
  h = (pebble - 0.5) * 0.00018 * urBand(0.004, fw) - smoothstep(0.62, 0.8, crease) * 0.0006 * urBand(0.02, fw);
  t = 0.6 * pebble + 0.4 * crease;
#elif UR_PATTERN == 4
  // Brushed metal: fine streaks along the limb, a few scratches.
  float streak = urNoise(p * vec3(1500.0, 12.0, 1500.0));
  float scratch = smoothstep(0.93, 1.0, urNoise(p * vec3(400.0, 3.0, 400.0)));
  h = (streak - 0.5) * 0.00004 * urBand(0.002, fw) - scratch * 0.00008 * urBand(0.006, fw);
  t = 0.7 * streak + 0.3 * scratch;
#elif UR_PATTERN == 5
  // Glazed ceramic: faint orange peel, slight grime in the low spots.
  float peel = urNoise(p * 220.0);
  h = (peel - 0.5) * 0.00006 * urBand(0.01, fw);
  t = urNoise(p * 18.0);
#elif UR_PATTERN == 6
  float speck = urNoise(p * 500.0);
  h = (speck - 0.5) * 0.0001 * urBand(0.004, fw) + (urNoise(p * 40.0) - 0.5) * 0.0003 * urBand(0.05, fw);
  t = speck;
#endif
  return vec2(h, t);
}
`;

const GLOVE_DECL = /* glsl */ `
/*ur01:glove*/
// The coat mesh also covers the hands: past each wrist it becomes a black leather glove.
uniform vec3 uUrWrist[2];
uniform vec3 uUrHandDir[2];
float urGlove(vec3 p) {
  float g = 0.0;
  for (int i = 0; i < 2; i++) {
    vec3 d = p - uUrWrist[i];
    float along = dot(d, uUrHandDir[i]);
    g = max(g, smoothstep(-0.045, -0.03, along) * (1.0 - smoothstep(0.2, 0.24, length(d))));
  }
  return g;
}
`;

const FRAGMENT_COLOR = /* glsl */ `
float urFw = length(fwidth(vUrBind));
vec2 urR = urRelief(vUrBind, urFw);
diffuseColor.rgb *= 1.0 + UR_TONE * (urR.y - 0.5);
#ifdef UR_GLOVES
float urG = urGlove(vUrBind);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.018, 0.016, 0.015) * (0.85 + 0.3 * urR.y), urG);
urR.x *= 1.0 - 0.75 * urG;
#endif
`;

const FRAGMENT_GLOVE_LIGHT = /* glsl */ `
#ifdef UR_GLOVES
material.roughness = mix(material.roughness, 0.42, urG);
material.sheenColor *= 1.0 - urG;
#endif
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
roughnessFactor = clamp(roughnessFactor + UR_ROUGH_VARIATION * (urR.y - 0.5), 0.02, 1.0);
`;

// Bump from the procedural height via screen-space derivatives (Mikkelsen's surface gradient).
const FRAGMENT_NORMAL = /* glsl */ `
{
  vec3 urPos = -vViewPosition;
  vec3 sx = dFdx(urPos);
  vec3 sy = dFdy(urPos);
  float dhx = dFdx(urR.x);
  float dhy = dFdy(urR.x);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  normal = normalize(abs(det) * normal - grad);
}
`;

function kindOf(m: Material): Ur01Material | null {
  const match = /^UR01 \/ ([a-z]+)/.exec(m.name);
  return match && (UR01_MATERIALS as readonly string[]).includes(match[1]) ? (match[1] as Ur01Material) : null;
}

/**
 * Re-materials UR-01: the GLB's textures are spread over hundreds of tiny UV islands and its coat is almost
 * black, so each material gets plausible albedo, gloss, sheen or clear coat, and (above Low) a solid
 * procedural relief evaluated on the bind-pose position, so the pattern stays put while UR-01 moves.
 */
export function upgradeCharacterMaterials(root: Object3D, opts: { tier: QualityTier }): void {
  const done = new Set<Material>();
  const hands = handFrames(root);
  root.traverse(o => {
    const mesh = o as Object3D & { material?: Material | Material[] };
    for (const material of [mesh.material ?? []].flat()) {
      if (done.has(material)) continue;
      done.add(material);
      const kind = kindOf(material);
      if (!kind) continue;
      const look = LOOKS[kind];
      const m = material as MeshPhysicalMaterial;
      m.color = new Color(...look.color);
      m.roughness = look.roughness;
      m.metalness = look.metalness;
      m.map = null;
      m.normalMap = null;
      m.roughnessMap = null;
      m.metalnessMap = null;
      if (look.sheen !== undefined) {
        m.sheen = look.sheen;
        m.sheenColor = new Color(...look.sheenColor!);
        m.sheenRoughness = look.sheenRoughness!;
      }
      if (look.clearcoat !== undefined) {
        m.clearcoat = look.clearcoat;
        m.clearcoatRoughness = look.clearcoatRoughness!;
      }
      if (look.envMapIntensity !== undefined) m.envMapIntensity = look.envMapIntensity;
      m.needsUpdate = true;
      if (opts.tier === 'low') continue;

      const pattern = PATTERN[look.pattern];
      const gloves = kind === 'fabric' ? hands : null;
      const tone = kind === 'fabric' ? 0.35 : kind === 'leather' ? 0.3 : 0.15;
      const roughVar = look.metalness > 0.5 ? 0.12 : 0.08;
      m.onBeforeCompile = shader => {
        shader.defines = {
          ...shader.defines,
          UR_PATTERN: pattern,
          UR_TONE: tone.toFixed(3),
          UR_ROUGH_VARIATION: roughVar.toFixed(3),
        };
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERTEX_DECL}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${FRAGMENT_DECL}`)
          .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAGMENT_COLOR}`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`);
        if (gloves) {
          shader.defines.UR_GLOVES = '';
          shader.uniforms.uUrWrist = { value: [gloves.L.wrist, gloves.R.wrist] };
          shader.uniforms.uUrHandDir = { value: [gloves.L.dir, gloves.R.dir] };
          shader.fragmentShader = shader.fragmentShader
            .replace('/*ur01:relief*/', `/*ur01:relief*/\n${GLOVE_DECL}`)
            .replace(
              '#include <lights_physical_fragment>',
              `#include <lights_physical_fragment>\n${FRAGMENT_GLOVE_LIGHT}`,
            );
        }
      };
      m.customProgramCacheKey = () => `ur01-${kind}`;
    }
  });
}

interface HandFrame {
  wrist: Vector3;
  dir: Vector3;
}

/** Wrist positions and hand directions in the coat mesh's bind space, from its skeleton. */
function handFrames(root: Object3D): { L: HandFrame; R: HandFrame } | null {
  let found: { L: HandFrame; R: HandFrame } | null = null;
  root.traverse(o => {
    const mesh = o as SkinnedMesh;
    if (found || !mesh.isSkinnedMesh || !mesh.skeleton) return;
    const at = (key: string) => {
      const i = mesh.skeleton.bones.findIndex(b => boneKey(b.name) === key);
      if (i < 0) return null;
      const bind = new Matrix4().copy(mesh.skeleton.boneInverses[i]).invert();
      return new Vector3().setFromMatrixPosition(bind).applyMatrix4(mesh.bindMatrixInverse);
    };
    const side = (s: 'l' | 'r'): HandFrame => {
      const wrist = at(`hand${s}`);
      const elbow = at(`forearm${s}`);
      // A missing hand parks the mask far away.
      if (!wrist || !elbow) return { wrist: new Vector3(1e6, 1e6, 1e6), dir: new Vector3(0, -1, 0) };
      return { wrist, dir: wrist.clone().sub(elbow).normalize() };
    };
    const L = side('l');
    if (L.wrist.x < 1e5) found = { L, R: side('r') };
  });
  return found;
}
