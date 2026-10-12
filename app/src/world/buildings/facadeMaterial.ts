import { MeshStandardMaterial, type Texture } from 'three';
import { TIER_SETTINGS, type QualityTier } from '../../engine/quality';

export interface TextureSet {
  map: Texture;
  normalMap: Texture;
  armMap: Texture;
}

export interface FacadeTextures {
  concrete: TextureSet;
  steel: TextureSet;
  brick: TextureSet;
}

/**
 * Mean radiance of a lit room seen through glass, measured from fRoom (wall albedo ~0.55 times
 * a ~4x lamp term with depth falloff). Far-away windows use LIT_ROOM_MEAN * litRatio so that the
 * distant average matches the near per-room pattern and no band appears where they meet.
 */
export const LIT_ROOM_MEAN = 1.6;

export type FacadeMaterial = MeshStandardMaterial & {
  uniforms: {
    uNight: { value: number };
    uLitRatio: { value: number };
    uTime: { value: number };
  };
};

const vertexPars = /* glsl */ `
attribute vec4 aBuilding;
attribute float aBays;
varying vec3 vFWorld;
varying vec3 vFNormal;
varying vec2 vFUv;
varying vec4 vFBuilding;
varying float vFBays;
`;

const vertexMain = /* glsl */ `
#include <project_vertex>
vFWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFNormal = normalize(mat3(modelMatrix) * objectNormal);
vFUv = uv;
vFBuilding = aBuilding;
vFBays = aBays;
`;

const fragmentPars = /* glsl */ `
#define LIT_ROOM_MEAN ${LIT_ROOM_MEAN.toFixed(3)}
uniform float uNight;
uniform float uLitRatio;
uniform float uTime;
uniform sampler2D tConcreteDiff;
uniform sampler2D tConcreteNorm;
uniform sampler2D tConcreteArm;
uniform sampler2D tBrickDiff;
uniform sampler2D tBrickNorm;
uniform sampler2D tBrickArm;
uniform sampler2D tSteelDiff;
varying vec3 vFWorld;
varying vec3 vFNormal;
varying vec2 vFUv;
varying vec4 vFBuilding;
varying float vFBays;

float fHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Integer PCG hash for lattice inputs (window x floor): float hashes show diagonal banding there.
uint fPcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

float fHashI(float a, float b, float c) {
  uvec3 q = uvec3(ivec3(int(a) + 65536, int(b) + 65536, int(c)));
  return float(fPcg(q.x + fPcg(q.y + fPcg(q.z)))) / 4294967295.0;
}

/*facade:farlit*/
// Expected fraction of lit rooms in a block of windows that one pixel covers. Blocks grow by 2x per
// level; the spread shrinks like the standard deviation of a mean over N rooms, with extra variance
// because whole floors tend to be lit or dark together.
float fLitAtLevel(float level, float cellX, float floorIndex, float seedI, float p) {
  float n = exp2(level);
  float m = exp2(max(level - 1.0, 0.0));
  float h = fHashI(floor(cellX / n) + level * 4096.0, floor(floorIndex / m), seedI + 17.0);
  float sigma = sqrt(p * (1.0 - p) / (n * m)) * 1.6;
  return clamp(p + (h - 0.5) * 3.46 * sigma, 0.0, 1.0);
}

float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

/** 1 inside [a.x, a.y] x [b.x, b.y] with a soft edge of e. */
float fBox(vec2 p, vec2 lo, vec2 hi, float e) {
  vec2 s = smoothstep(lo - e, lo + e, p) * (1.0 - smoothstep(hi - e, hi + e, p));
  return s.x * s.y;
}

// Window opening per style, as fractions of a bay (x) and a floor (y): x0, x1, y0, y1.
vec4 fOpening(float style, float floorIndex) {
  if (floorIndex < 0.5 && style < 2.5) return vec4(0.06, 0.94, 0.05, 0.8); // storefronts
  if (style < 0.5) return vec4(0.22, 0.78, 0.2, 0.82);   // art deco: tall punched windows
  if (style < 1.5) return vec4(0.03, 0.97, 0.3, 0.8);    // modernist: ribbon windows
  if (style < 2.5) return vec4(0.18, 0.82, 0.18, 0.76);  // industrial: big multi-pane
  return vec4(0.015, 0.985, 0.07, 0.97);                 // curtain wall
}

float fRecess(float style) {
  return style < 0.5 ? 0.24 : style < 1.5 ? 0.12 : style < 2.5 ? 0.3 : 0.03;
}

vec3 fLightColor(float h) {
  return h < 0.45 ? vec3(1.0, 0.72, 0.42) : h < 0.85 ? vec3(1.0, 0.85, 0.66) : vec3(0.86, 0.92, 1.0);
}

/*facade:interior*/
// Ray-marches a box room behind the glass. p: point on glass in room space (meters),
// rd: view ray in room space (x along wall, y up, z into the building).
vec3 fRoom(vec3 p, vec3 rd, vec3 roomSize, float h, float lit, float night) {
  vec3 tMax = vec3(
    rd.x > 0.0 ? (roomSize.x - p.x) / rd.x : -p.x / min(rd.x, -1e-4),
    rd.y > 0.0 ? (roomSize.y - p.y) / rd.y : -p.y / min(rd.y, -1e-4),
    (roomSize.z - p.z) / max(rd.z, 1e-4)
  );
  float t = min(tMax.x, min(tMax.y, tMax.z));
  vec3 hit = p + rd * t;

  vec3 wallCol = mix(vec3(0.62, 0.58, 0.52), vec3(0.5, 0.55, 0.58), fHash(vec2(h, 3.1)));
  wallCol = mix(wallCol, vec3(0.7, 0.66, 0.6), step(0.7, fHash(vec2(h, 5.7))));
  vec3 floorCol = mix(vec3(0.32, 0.22, 0.14), vec3(0.28, 0.29, 0.3), step(0.5, fHash(vec2(h, 8.3))));
  vec3 ceilCol = vec3(0.78);
  vec3 col;
  if (t == tMax.z) {
    col = wallCol * 0.9;
    #ifdef FACADE_FURNITURE
    /*facade:furniture*/
    float shelfX = fHash(vec2(h, 11.0)) * roomSize.x * 0.5;
    float shelf = fBox(hit.xy, vec2(shelfX, 0.0), vec2(shelfX + roomSize.x * 0.42, 0.75 + fHash(vec2(h, 13.0)) * 1.1), 0.02);
    col = mix(col, vec3(0.12, 0.1, 0.09), shelf * 0.85);
    float art = fBox(hit.xy, vec2(roomSize.x * 0.55, 1.4), vec2(roomSize.x * 0.8, 2.1), 0.02) * step(0.55, fHash(vec2(h, 17.0)));
    col = mix(col, vec3(0.5, 0.36, 0.25), art);
    #endif
  } else if (t == tMax.y) {
    col = rd.y < 0.0 ? floorCol : ceilCol;
  } else {
    col = wallCol * 0.75;
  }
  // Corner occlusion and depth falloff.
  float depthShade = mix(1.0, 0.55, clamp(hit.z / roomSize.z, 0.0, 1.0));
  vec3 lightCol = fLightColor(fHash(vec2(h, 21.0)));
  float fixture = exp(-dot(hit.xz - vec2(roomSize.x * 0.5, roomSize.z * 0.5), hit.xz - vec2(roomSize.x * 0.5, roomSize.z * 0.5)) * 0.35);
  float ceilingGlow = (t == tMax.y && rd.y > 0.0) ? fixture * 2.5 : 0.0;
  vec3 nightLight = lightCol * (0.9 + ceilingGlow + 0.6 * (1.0 - hit.y / roomSize.y));
  vec3 dayLight = vec3(0.16, 0.17, 0.18);
  vec3 light = mix(dayLight, lit * nightLight * (1.4 + 2.6 * fHash(vec2(h, 25.0))) + vec3(0.004), night);
  return col * light * depthShade;
}
`;

const fragmentSurface = /* glsl */ `
#include <map_fragment>
/*facade:surface*/
/*facade:windows*/
float fStyle = vFBuilding.y;
float fFloorH = vFBuilding.z;
float fBay = vFBuilding.w;
float fSeed = vFBuilding.x;
vec3 fN = normalize(vFNormal);
vec3 fT = normalize(cross(vec3(0.0, 1.0, 0.0), fN));
vec3 fV = normalize(cameraPosition - vFWorld);
vec3 fVt = vec3(dot(fV, fT), fV.y, max(dot(fV, fN), 0.02));

vec2 fUv = vFUv;
// Pixel footprint in meters drives edge antialiasing and the far-distance average.
vec2 fFw = max(fwidth(fUv), vec2(1e-4));
// A per-window pattern aliases into moiré once a pixel spans more than half a bay (Nyquist), so fade early.
float fFar = smoothstep(0.15, 0.5, max(fFw.x / fBay, fFw.y / fFloorH));
float fCellX = floor(fUv.x / fBay);
float fFloor = floor(fUv.y / fFloorH);
vec2 fCell = vec2(fUv.x / fBay, fUv.y / fFloorH) - vec2(fCellX, fFloor);
float fInBays = step(0.0, fCellX) * step(fCellX, vFBays - 0.5);
vec4 fOpen = fOpening(fStyle, fFloor);
vec2 fLo = vec2(fOpen.x * fBay, fOpen.z * fFloorH);
vec2 fHi = vec2(fOpen.y * fBay, fOpen.w * fFloorH);
vec2 fLocal = fCell * vec2(fBay, fFloorH);
float fEdge = max(fFw.x, fFw.y) * 0.75;

// Wall material per style. Textures only add detail: they are normalised to their mean
// and multiplied onto a physically plausible base albedo.
vec2 fTexUv = fUv / (fStyle > 1.5 && fStyle < 2.5 ? 3.0 : 4.0);
float fTint = fHash(vec2(fSeed * 97.0, 1.0));
vec3 fWallAlbedo;
vec3 fWallNormal;
float fWallRough;
if (fStyle > 1.5 && fStyle < 2.5) {
  fWallAlbedo = texture2D(tBrickDiff, fTexUv).rgb * mix(vec3(0.85, 0.8, 0.78), vec3(1.1, 0.95, 0.85), fTint);
  fWallNormal = texture2D(tBrickNorm, fTexUv).xyz * 2.0 - 1.0;
  fWallRough = texture2D(tBrickArm, fTexUv).g;
} else {
  vec3 detail = texture2D(tConcreteDiff, fTexUv).rgb / vec3(0.034, 0.035, 0.042);
  detail = mix(vec3(1.0), detail, 0.45);
  fWallNormal = texture2D(tConcreteNorm, fTexUv).xyz * 2.0 - 1.0;
  fWallRough = texture2D(tConcreteArm, fTexUv).g;
  vec3 base;
  if (fStyle < 0.5) base = mix(vec3(0.5, 0.45, 0.36), vec3(0.58, 0.52, 0.42), fTint);        // limestone
  else if (fStyle < 1.5) base = mix(vec3(0.34, 0.35, 0.36), vec3(0.46, 0.44, 0.4), fTint);   // concrete
  else base = mix(vec3(0.05, 0.058, 0.065), vec3(0.09, 0.09, 0.085), fTint);               // spandrel
  fWallAlbedo = base * detail;
}
// Grime: darker towards the street and in vertical streaks below sills.
float fGrime = fNoise(vec2(fUv.x * 0.7, fUv.y * 0.05) + fSeed * 40.0);
float fBelow = fLo.y - fLocal.y;
float fStreak = fInBays * step(fLo.x, fLocal.x) * step(fLocal.x, fHi.x) * smoothstep(0.0, 0.2, fBelow)
  * (1.0 - smoothstep(0.2, 1.8, fBelow)) * fNoise(vec2(fUv.x * 6.0, fFloor)) * (1.0 - fFar);
fWallAlbedo *= mix(1.0, 0.72, fStreak * 0.8) * mix(0.82, 1.0, smoothstep(0.0, 6.0, fUv.y)) * mix(0.9, 1.05, fGrime);

vec3 fAlbedo = fWallAlbedo;
float fRough = mix(0.72, 0.92, fWallRough);
float fMetal = fStyle > 2.5 ? 0.35 : 0.0;
vec3 fNormalT = normalize(vec3(fWallNormal.xy * mix(0.6, 0.15, fFar), 1.0));
vec3 fEmissive = vec3(0.0);
float fAO = 1.0;

// Stone sill under punched windows; slab edges on curtain walls.
float fSill = fInBays * fBox(fLocal, vec2(fLo.x - 0.08, fLo.y - 0.09), vec2(fHi.x + 0.08, fLo.y), fEdge) * step(0.5, fFloor);
if (fStyle < 2.5) {
  fAlbedo = mix(fAlbedo, vec3(0.62, 0.6, 0.56), fSill * 0.6 * (1.0 - fFar));
  fNormalT = normalize(mix(fNormalT, vec3(0.0, 0.8, 0.6), fSill * (1.0 - fFar)));
}

float fOpenCover = fInBays * fBox(fLocal, fLo, fHi, fEdge);
if (fOpenCover > 0.001) {
  // The glass sits back by the reveal depth; the parallax shift decides if we see glass or the reveal.
  float depth = fRecess(fStyle) * (1.0 - fFar);
  vec2 shift = -fVt.xy / fVt.z * depth;
  vec2 g = clamp(fLocal + shift, fLo - 0.5, fHi + 0.5);
  float glassCover = fBox(g, fLo, fHi, fEdge);
  vec2 gi = g - fLo;
  vec2 gs = fHi - fLo;

  // Frames and mullions, antialiased by the same edge width.
  float frameW = 0.055;
  float frame = 1.0 - fBox(gi, vec2(frameW), gs - frameW, fEdge);
  if (fStyle < 0.5) {
    frame = max(frame, 1.0 - smoothstep(0.025 - fEdge, 0.025 + fEdge, abs(gi.x - gs.x * 0.5)));
    frame = max(frame, 1.0 - smoothstep(0.025 - fEdge, 0.025 + fEdge, abs(gi.y - gs.y * 0.72)));
  } else if (fStyle < 1.5) {
    frame = max(frame, 1.0 - smoothstep(0.03 - fEdge, 0.03 + fEdge, abs(mod(gi.x + 0.6, 1.2) - 0.6)));
  } else if (fStyle < 2.5) {
    vec2 paneSize = gs / vec2(3.0, 4.0);
    vec2 pane = abs(mod(gi, paneSize) - paneSize * 0.5);
    float bar = min(paneSize.x * 0.5 - pane.x, paneSize.y * 0.5 - pane.y);
    frame = max(frame, 1.0 - smoothstep(0.02 - fEdge, 0.02 + fEdge, bar));
  }
  frame = mix(frame, 0.12, fFar);
  float frameTone = fStyle > 1.5 && fStyle < 2.5 ? 0.04 : fHash(vec2(fSeed, 9.0)) < 0.5 ? 0.04 : 0.5;

  // Interior behind the glass.
  float seedI = floor(fSeed * 1048576.0);
  float roomSpan = 1.0 + floor(fHashI(fFloor, 7.0, seedI) * 3.0);
  float roomIdx = floor(fCellX / roomSpan);
  float h = fHashI(roomIdx, fFloor, seedI);
  // Some floors are mostly dark, others mostly lit, around the global ratio.
  float floorLit = clamp(uLitRatio * (0.15 + 1.7 * fHashI(fFloor, 3.0, seedI)), 0.0, 0.95);
  float lit = step(h, floorLit);
  vec3 room;
  if (fFar < 0.99) {
    vec3 rd = normalize(vec3(-fVt.x, -fVt.y, fVt.z));
    vec3 roomSize = vec3(roomSpan * fBay, fFloorH, max(3.0, fFloorH * 0.9));
    vec3 p = vec3(g.x + (fCellX - roomIdx * roomSpan) * fBay, clamp(g.y, 0.01, fFloorH - 0.01), 0.0);
    room = fRoom(p, rd, roomSize, h, lit, uNight);
    float blinds = step(0.62, fHash(vec2(h, 33.0)));
    float blindLevel = mix(fLo.y + 0.3, fHi.y, fHash(vec2(h, 35.0)));
    if (blinds > 0.5 && g.y > blindLevel) {
      float slat = 0.75 + 0.25 * step(0.5, fract(g.y * 18.0));
      room = mix(vec3(0.5, 0.48, 0.44) * 0.2, fLightColor(fHash(vec2(h, 21.0))) * 0.8 * lit, uNight) * slat;
    }
  } else {
    room = vec3(0.0);
  }
  // Far away, one pixel covers several rooms: use their expected glow instead of one random room.
  float level = clamp(log2(max(fFw.x / fBay, fFw.y / fFloorH) * 2.0), 0.0, 6.0);
  float fFarLit = mix(
    fLitAtLevel(floor(level), fCellX, fFloor, seedI, uLitRatio),
    fLitAtLevel(floor(level) + 1.0, fCellX, fFloor, seedI, uLitRatio),
    fract(level)
  );
  vec3 farRoom = mix(vec3(0.05), vec3(1.0, 0.82, 0.6) * LIT_ROOM_MEAN * fFarLit + vec3(0.004), uNight);
  room = mix(room, farRoom, fFar);

  float cosT = clamp(fVt.z, 0.0, 1.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
  vec3 glassEmissive = room * (1.0 - fresnel) * (1.0 - frame);
  // Curtain walls use coated, more reflective glass (F0 ~0.08) with a blue-grey tint.
  float coated = step(2.5, fStyle);
  vec3 paneAlbedo = mix(vec3(0.02, 0.025, 0.03), vec3(0.11, 0.14, 0.17), coated);
  vec3 glassAlbedo = mix(paneAlbedo, vec3(frameTone), frame);
  float glassRough = mix(mix(0.035, 0.05, coated), 0.45, frame);
  float glassMetal = mix(0.35 * coated, 0.6, frame);
  vec3 glassNormal = normalize(vec3((fNoise(g * 1.3 + fSeed * 50.0) - 0.5) * 0.03, (fNoise(g.yx * 1.1 + fCellX) - 0.5) * 0.03, 1.0));

  // Reveal: the side of the window recess, in shadow.
  vec3 revealNormal = g.x <= fLo.x + 0.01 ? vec3(0.7, 0.0, 0.7) : g.x >= fHi.x - 0.01 ? vec3(-0.7, 0.0, 0.7)
    : g.y <= fLo.y + 0.01 ? vec3(0.0, 0.7, 0.7) : vec3(0.0, -0.7, 0.7);

  float c = fOpenCover;
  fAlbedo = mix(fAlbedo, mix(fWallAlbedo * 0.82, glassAlbedo, glassCover), c);
  fRough = mix(fRough, mix(fRough, glassRough, glassCover), c);
  fMetal = mix(fMetal, mix(0.0, glassMetal, glassCover), c);
  fNormalT = normalize(mix(fNormalT, mix(revealNormal, glassNormal, glassCover), c));
  fEmissive = glassEmissive * glassCover * c;
  fAO = mix(1.0, mix(0.55, 1.0, glassCover), c);
}
diffuseColor.rgb = fAlbedo;
`;

const fragmentRoughness = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = fRough;
`;

const fragmentMetalness = /* glsl */ `
#include <metalnessmap_fragment>
metalnessFactor = fMetal;
`;

const fragmentNormal = /* glsl */ `
#include <normal_fragment_maps>
/*facade:normal*/
{
  vec3 nWorld = normalize(fT * fNormalT.x + vec3(0.0, 1.0, 0.0) * fNormalT.y + fN * fNormalT.z);
  normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
}
`;

const fragmentEmissive = /* glsl */ `
#include <emissivemap_fragment>
/*facade:emissive*/
totalEmissiveRadiance += fEmissive;
`;

const fragmentAo = /* glsl */ `
#include <aomap_fragment>
/*facade:ao*/
reflectedLight.indirectDiffuse *= fAO;
reflectedLight.directDiffuse *= mix(1.0, fAO, 0.6);
`;

function inject(source: string, include: string, replacement: string): string {
  const token = `#include <${include}>`;
  if (!source.includes(token)) throw new Error(`facade shader: missing ${token}`);
  return source.replace(token, replacement);
}

export function createFacadeMaterial(opts: { tier: QualityTier; textures: FacadeTextures }): FacadeMaterial {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 }) as FacadeMaterial;
  material.name = 'Facade';
  material.uniforms = { uNight: { value: 0 }, uLitRatio: { value: 0.04 }, uTime: { value: 0 } };
  const furniture = TIER_SETTINGS[opts.tier].interiorFurniture;
  const t = opts.textures;

  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, material.uniforms, {
      tConcreteDiff: { value: t.concrete.map },
      tConcreteNorm: { value: t.concrete.normalMap },
      tConcreteArm: { value: t.concrete.armMap },
      tBrickDiff: { value: t.brick.map },
      tBrickNorm: { value: t.brick.normalMap },
      tBrickArm: { value: t.brick.armMap },
      tSteelDiff: { value: t.steel.map },
    });
    shader.vertexShader = inject(shader.vertexShader, 'common', `#include <common>\n${vertexPars}`);
    shader.vertexShader = inject(shader.vertexShader, 'project_vertex', vertexMain);
    let fs = shader.fragmentShader;
    fs = inject(fs, 'common', `#include <common>\n${furniture ? '#define FACADE_FURNITURE\n' : ''}${fragmentPars}`);
    if (!furniture) fs = fs.replace('/*facade:furniture*/', '');
    fs = inject(fs, 'map_fragment', fragmentSurface);
    fs = inject(fs, 'roughnessmap_fragment', fragmentRoughness);
    fs = inject(fs, 'metalnessmap_fragment', fragmentMetalness);
    fs = inject(fs, 'normal_fragment_maps', fragmentNormal);
    fs = inject(fs, 'emissivemap_fragment', fragmentEmissive);
    fs = inject(fs, 'aomap_fragment', fragmentAo);
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => `facade-${opts.tier}`;
  return material;
}
