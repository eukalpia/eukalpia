import { Pass } from 'postprocessing';
import {
  BasicDepthPacking,
  Color,
  Data3DTexture,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type DepthPackingStrategies,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { LightingPreset } from '../lighting/timeOfDay';
import { TIER_SETTINGS, type QualityTier } from '../quality';
import { generateCloudNoise } from './noise3d';

export const CLOUD_TOP = -300;
export const CLOUD_BOTTOM = -430;
const NOISE_SIZE = 64;

const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const marchFragment = /* glsl */ `
#include <packing>
precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D tDepth;
uniform vec2 uDepthTexel;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uCamPos;
uniform float uNear;
uniform float uFar;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientTop;
uniform vec3 uAmbientBottom;
uniform vec3 uCityGlow;
uniform float uTime;
uniform float uCoverage;
varying vec2 vUv;

const float TOP = ${CLOUD_TOP.toFixed(1)};
const float BOTTOM = ${CLOUD_BOTTOM.toFixed(1)};
const float SIGMA = 0.045;

float readDepth(vec2 uv) {
#if DEPTH_PACKING == 3201
  return unpackRGBAToDepth(texture2D(tDepth, uv));
#else
  return texture2D(tDepth, uv).r;
#endif
}

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
  // Short steps towards the light for self-shadowing.
  float shadow = 0.0;
  for (int i = 1; i <= 3; i++) shadow += density(p + uSunDir * float(i) * 28.0);
  float sunT = exp(-shadow * SIGMA * 28.0) * (1.0 - exp(-d * 6.0));
  float h = clamp((p.y - BOTTOM) / (TOP - BOTTOM), 0.0, 1.0);
  vec3 ambient = mix(uAmbientBottom, uAmbientTop, h);
  float glow = exp(-pow(length(p.xz) / 520.0, 2.0)) * h * h;
  return uSunColor * sunT * phase(mu) * 12.566 + ambient + uCityGlow * glow;
}

void main() {
  vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dirView = normalize(view.xyz / view.w);
  vec3 rd = normalize((uViewInv * vec4(dirView, 0.0)).xyz);
  vec3 ro = uCamPos;

  /*clouds:scene-depth*/
  // Nearest surface over the 2x2 full-resolution block this half-resolution pixel covers.
  float depth = min(min(readDepth(vUv + uDepthTexel * vec2(-0.5, -0.5)), readDepth(vUv + uDepthTexel * vec2(0.5, -0.5))),
                    min(readDepth(vUv + uDepthTexel * vec2(-0.5, 0.5)), readDepth(vUv + uDepthTexel * vec2(0.5, 0.5))));
  float sceneDistance = 1e9;
  if (depth < 0.999999) sceneDistance = perspectiveDepthToViewZ(depth, uNear, uFar) / dirView.z;

  float t0;
  float t1;
  if (abs(rd.y) < 1e-4) {
    if (ro.y < BOTTOM || ro.y > TOP) { gl_FragColor = vec4(0.0); return; }
    t0 = 0.0;
    t1 = 4000.0;
  } else {
    float ta = (TOP - ro.y) / rd.y;
    float tb = (BOTTOM - ro.y) / rd.y;
    t0 = max(min(ta, tb), 0.0);
    t1 = max(ta, tb);
  }
  t1 = min(min(t1, t0 + 2600.0), sceneDistance);
  if (t1 <= t0) { gl_FragColor = vec4(0.0); return; }

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
    if (t < 0.0 || t > sceneDistance) continue;
    vec3 p = ro + rd * t;
    float d = density(vec3(p.x, mix(BOTTOM, TOP, 0.35), p.z));
    float a = clamp(d * 1.6, 0.0, 1.0) * 0.8;
    light += transmittance * shade(p, d, mu) * a;
    transmittance *= 1.0 - a;
  }
#endif
  float distanceFade = 1.0 - smoothstep(3200.0, 5200.0, t0);
  gl_FragColor = vec4(light * distanceFade, (1.0 - transmittance) * distanceFade);
}`;

const compositeFragment = /* glsl */ `
uniform sampler2D inputBuffer;
uniform sampler2D tClouds;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(inputBuffer, vUv);
  vec4 cloud = texture2D(tClouds, vUv);
  gl_FragColor = vec4(base.rgb * (1.0 - cloud.a) + cloud.rgb, base.a);
}`;

/**
 * The cloud sea as a post pass: raymarched at half resolution against the scene depth, then
 * composited over the frame. Clouds in front of an island occlude it; clouds behind it do not.
 */
export class CloudPass extends Pass {
  readonly target: WebGLRenderTarget;
  readonly marchMaterial: ShaderMaterial;
  private readonly compositeMaterial: ShaderMaterial;
  private readonly noise: Data3DTexture;
  private readonly viewCamera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera, tier: QualityTier) {
    super('CloudPass');
    this.viewCamera = camera;
    this.needsDepthTexture = true;
    this.target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    this.target.texture.minFilter = this.target.texture.magFilter = LinearFilter;

    const data = generateCloudNoise(NOISE_SIZE, 1337);
    this.noise = new Data3DTexture(data, NOISE_SIZE, NOISE_SIZE, NOISE_SIZE);
    this.noise.format = RedFormat;
    this.noise.minFilter = this.noise.magFilter = LinearFilter;
    this.noise.wrapS = this.noise.wrapT = this.noise.wrapR = RepeatWrapping;
    this.noise.unpackAlignment = 1;
    this.noise.needsUpdate = true;

    this.marchMaterial = new ShaderMaterial({
      name: 'CloudMarch',
      defines: { CLOUD_STEPS: TIER_SETTINGS[tier].cloudSteps, DEPTH_PACKING: BasicDepthPacking },
      uniforms: {
        uNoise: { value: this.noise },
        tDepth: { value: null },
        uDepthTexel: { value: new Vector2() },
        uProjInv: { value: new Matrix4() },
        uViewInv: { value: new Matrix4() },
        uCamPos: { value: new Vector3() },
        uNear: { value: 1 },
        uFar: { value: 1000 },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uAmbientTop: { value: new Color() },
        uAmbientBottom: { value: new Color() },
        uCityGlow: { value: new Color() },
        uTime: { value: 0 },
        uCoverage: { value: 0.58 },
      },
      vertexShader: fullscreenVertex,
      fragmentShader: marchFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = new ShaderMaterial({
      name: 'CloudComposite',
      uniforms: { inputBuffer: { value: null }, tClouds: { value: this.target.texture } },
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.compositeMaterial;
  }

  override setDepthTexture(depthTexture: Texture | null, depthPacking: DepthPackingStrategies = BasicDepthPacking) {
    this.marchMaterial.uniforms.tDepth.value = depthTexture;
    if (this.marchMaterial.defines.DEPTH_PACKING !== depthPacking) {
      this.marchMaterial.defines.DEPTH_PACKING = depthPacking;
      this.marchMaterial.needsUpdate = true;
    }
  }

  override setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
    this.marchMaterial.uniforms.uDepthTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget) {
    const u = this.marchMaterial.uniforms;
    const cam = this.viewCamera;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uViewInv.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;

    this.fullscreenMaterial = this.marchMaterial;
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);

    this.fullscreenMaterial = this.compositeMaterial;
    this.compositeMaterial.uniforms.inputBuffer.value = inputBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  setPreset(p: LightingPreset, sunDir: Vector3, night: boolean) {
    const u = this.marchMaterial.uniforms;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.set(p.sunColor).multiplyScalar(p.sunIntensity * (night ? 1.6 : 0.85));
    if (night) {
      u.uAmbientTop.value.set(0x0b1322);
      u.uAmbientBottom.value.set(0x03050a);
      u.uCityGlow.value.set(0xff9a4a).multiplyScalar(0.55);
    } else {
      u.uAmbientTop.value.set(0x9fb6d2).multiplyScalar(1.15);
      u.uAmbientBottom.value.set(0x56667a).multiplyScalar(0.8);
      u.uCityGlow.value.set(0x000000);
    }
  }

  update(seconds: number) {
    this.marchMaterial.uniforms.uTime.value = seconds;
  }

  override dispose() {
    this.target.dispose();
    this.noise.dispose();
    this.marchMaterial.dispose();
    this.compositeMaterial.dispose();
    super.dispose();
  }
}
