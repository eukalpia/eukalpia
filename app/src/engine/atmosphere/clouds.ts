import {
  BackSide,
  BoxGeometry,
  Color,
  Data3DTexture,
  LinearFilter,
  Mesh,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { LightingPreset } from '../lighting/timeOfDay';
import { TIER_SETTINGS, type QualityTier } from '../quality';
import { generateCloudNoise } from './noise3d';

export const CLOUD_TOP = -300;
export const CLOUD_BOTTOM = -430;
const EXTENT = 9000;
const NOISE_SIZE = 64;

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uNoise;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientTop;
uniform vec3 uAmbientBottom;
uniform vec3 uCityGlow;
uniform float uTime;
uniform float uCoverage;
varying vec3 vWorld;

const float TOP = ${CLOUD_TOP.toFixed(1)};
const float BOTTOM = ${CLOUD_BOTTOM.toFixed(1)};
const float SIGMA = 0.045;

float density(vec3 p) {
  float h = clamp((p.y - BOTTOM) / (TOP - BOTTOM), 0.0, 1.0);
  vec3 wind = vec3(uTime * 2.2, 0.0, uTime * 1.1);
  float n = texture(uNoise, (p + wind) / 1100.0).r;
  float coverage = uCoverage + (texture(uNoise, vec3((p.xz + wind.xz * 0.3) / 5200.0, 0.37)).r - 0.5) * 0.5;
  // Flat bases, rounded tops.
  float profile = smoothstep(0.0, 0.18, h) * (1.0 - smoothstep(0.45, 1.0, h));
  float shape = clamp((n - (1.0 - coverage)) / max(coverage, 0.05), 0.0, 1.0) * profile;
  float detail = texture(uNoise, (p - wind * 1.7) / 260.0).r;
  return clamp(shape - detail * 0.35 * (1.0 - shape), 0.0, 1.0);
}

float phase(float mu) {
  float g = 0.55;
  float hg = (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
  return 0.7 * hg + 0.3 / 12.566;
}

vec3 shade(vec3 p, float d, float mu) {
  // Three short steps towards the light for self-shadowing.
  float shadow = 0.0;
  for (int i = 1; i <= 3; i++) shadow += density(p + uSunDir * float(i) * 28.0);
  float sunT = exp(-shadow * SIGMA * 28.0) * (1.0 - exp(-d * 6.0));
  float h = clamp((p.y - BOTTOM) / (TOP - BOTTOM), 0.0, 1.0);
  vec3 ambient = mix(uAmbientBottom, uAmbientTop, h);
  float glow = exp(-pow(length(p.xz) / 520.0, 2.0)) * h * h;
  return uSunColor * sunT * phase(mu) * 12.566 + ambient + uCityGlow * glow;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  float t0;
  float t1;
  if (abs(rd.y) < 1e-4) {
    if (ro.y < BOTTOM || ro.y > TOP) discard;
    t0 = 0.0;
    t1 = 4000.0;
  } else {
    float ta = (TOP - ro.y) / rd.y;
    float tb = (BOTTOM - ro.y) / rd.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = max(ta, tb);
  }
  if (t1 <= t0) discard;
  t1 = min(t1, t0 + 2600.0);
  float mu = dot(rd, uSunDir);
  vec3 light = vec3(0.0);
  float transmittance = 1.0;
#if CLOUD_STEPS > 0
  float dt = (t1 - t0) / float(CLOUD_STEPS);
  // Interleaved gradient noise: a low-discrepancy jitter that reads as fine grain, not speckle.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < CLOUD_STEPS; i++) {
    vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
    float d = density(p);
    if (d > 0.002) {
      float sampleT = exp(-d * SIGMA * dt);
      light += transmittance * shade(p, d, mu) * (1.0 - sampleT);
      transmittance *= sampleT;
      if (transmittance < 0.02) break;
    }
  }
#else
  // Cheap path: three thin layers through the slab.
  for (int i = 0; i < 3; i++) {
    float y = mix(TOP - 20.0, BOTTOM + 30.0, float(i) / 2.0);
    float t = (y - ro.y) / rd.y;
    if (t < 0.0) continue;
    vec3 p = ro + rd * t;
    float d = density(vec3(p.x, mix(BOTTOM, TOP, 0.35), p.z));
    float a = clamp(d * 1.6, 0.0, 1.0) * 0.8;
    light += transmittance * shade(p, d, mu) * a;
    transmittance *= 1.0 - a;
  }
#endif
  float distanceFade = 1.0 - smoothstep(3200.0, 5200.0, t0);
  float alpha = (1.0 - transmittance) * distanceFade;
  gl_FragColor = vec4(light * distanceFade, alpha);
}`;

export interface CloudRig {
  mesh: Mesh;
  setPreset(p: LightingPreset, sunDir: Vector3, night: boolean): void;
  update(seconds: number): void;
  dispose(): void;
}

export function createClouds(tier: QualityTier): CloudRig {
  const data = generateCloudNoise(NOISE_SIZE, 1337);
  const noise = new Data3DTexture(data, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
  noise.format = RedFormat;
  noise.minFilter = noise.magFilter = LinearFilter;
  noise.wrapS = noise.wrapT = noise.wrapR = RepeatWrapping;
  noise.unpackAlignment = 1;
  noise.needsUpdate = true;

  const material = new ShaderMaterial({
    name: 'CloudSea',
    defines: { CLOUD_STEPS: TIER_SETTINGS[tier].cloudSteps },
    uniforms: {
      uNoise: { value: noise },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunColor: { value: new Color() },
      uAmbientTop: { value: new Color() },
      uAmbientBottom: { value: new Color() },
      uCityGlow: { value: new Color() },
      uTime: { value: 0 },
      uCoverage: { value: 0.58 },
    },
    vertexShader,
    fragmentShader,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
  });

  const height = CLOUD_TOP - CLOUD_BOTTOM;
  const geometry = new BoxGeometry(EXTENT, height, EXTENT).translate(0, (CLOUD_TOP + CLOUD_BOTTOM) / 2, 0);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.name = 'CloudSea';

  return {
    mesh,
    setPreset(p, sunDir, night) {
      const u = material.uniforms;
      u.uSunDir.value.copy(sunDir);
      u.uSunColor.value.set(p.sunColor).multiplyScalar(p.sunIntensity * (night ? 1.6 : 0.85));
      if (night) {
        u.uAmbientTop.value.set(0x0b1322).multiplyScalar(1.0);
        u.uAmbientBottom.value.set(0x03050a);
        u.uCityGlow.value.set(0xff9a4a).multiplyScalar(0.55);
      } else {
        u.uAmbientTop.value.set(0x9fb6d2).multiplyScalar(1.15);
        u.uAmbientBottom.value.set(0x56667a).multiplyScalar(0.8);
        u.uCityGlow.value.set(0x000000);
      }
    },
    update(seconds) {
      material.uniforms.uTime.value = seconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      noise.dispose();
    },
  };
}
