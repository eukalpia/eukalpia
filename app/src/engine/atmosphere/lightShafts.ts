import { Pass } from 'postprocessing';
import {
  BasicDepthPacking,
  Color,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type DepthPackingStrategies,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { QualityTier } from '../quality';

const SKY_DEPTH = 0.999999;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How much a pixel emits shafts: open sky only, strongest around the sun (TS mirror of the GLSL). */
export function shaftMask(depth: number, cosToSun: number): number {
  if (depth < SKY_DEPTH) return 0;
  const c = Math.max(cosToSun, 0);
  return Math.pow(c, 48) + 0.25 * Math.pow(c, 6);
}

/** Overall strength: only with the sun ahead of the camera and low in the sky (golden hour). */
export function shaftStrength(sunDir: Vector3, cameraForward: Vector3): number {
  const facing = smooth(-0.1, 0.4, sunDir.dot(cameraForward));
  const elevation = (Math.asin(Math.max(-1, Math.min(1, sunDir.y))) * 180) / Math.PI;
  return facing * smooth(45, 25, elevation);
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

const maskFragment = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uSunDir;
varying vec2 vUv;
float readDepth(vec2 uv) {
#if DEPTH_PACKING == 3201
  return unpackRGBAToDepth(texture2D(tDepth, uv));
#else
  return texture2D(tDepth, uv).r;
#endif
}
void main() {
  float depth = readDepth(vUv);
  vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize((uViewInv * vec4(v.xyz / v.w, 0.0)).xyz);
  float c = max(dot(dir, uSunDir), 0.0);
  float mask = depth < ${SKY_DEPTH} ? 0.0 : pow(c, 48.0) + 0.25 * pow(c, 6.0);
  gl_FragColor = vec4(mask, 0.0, 0.0, 1.0);
}
`;

const blurFragment = /* glsl */ `
uniform sampler2D tMask;
uniform vec2 uSunUv;
uniform float uDensity;
uniform float uDecay;
varying vec2 vUv;
void main() {
  /*shafts:radial*/
  vec2 delta = (vUv - uSunUv) * (uDensity / float(SHAFT_SAMPLES));
  vec2 uv = vUv;
  float illumination = 1.0;
  float sum = 0.0;
  for (int i = 0; i < SHAFT_SAMPLES; i++) {
    uv -= delta;
    sum += texture2D(tMask, clamp(uv, 0.0, 1.0)).r * illumination;
    illumination *= uDecay;
  }
  gl_FragColor = vec4(sum / float(SHAFT_SAMPLES), 0.0, 0.0, 1.0);
}
`;

const compositeFragment = /* glsl */ `
uniform sampler2D inputBuffer;
uniform sampler2D tShafts;
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(inputBuffer, vUv);
  gl_FragColor = vec4(base.rgb + texture2D(tShafts, vUv).r * uColor * uIntensity, base.a);
}
`;

/**
 * Light shafts at golden hour: open sky around the sun is blurred radially towards it at half
 * resolution, so buildings and trees cut dark wedges into the light, then added over the frame.
 */
export class LightShaftsPass extends Pass {
  readonly maskMaterial: ShaderMaterial;
  readonly blurMaterial: ShaderMaterial;
  private readonly compositeMaterial: ShaderMaterial;
  private readonly mask = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly shafts = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly viewCamera: PerspectiveCamera;
  private readonly sunDir = new Vector3(0, 1, 0);
  private strength = 0;
  private readonly forward = new Vector3();
  private readonly sunPoint = new Vector3();

  constructor(camera: PerspectiveCamera, tier: QualityTier) {
    super('LightShaftsPass');
    this.viewCamera = camera;
    this.needsDepthTexture = true;
    this.enabled = tier !== 'low';
    for (const t of [this.mask, this.shafts]) t.texture.minFilter = t.texture.magFilter = LinearFilter;
    this.maskMaterial = new ShaderMaterial({
      name: 'ShaftMask',
      defines: { DEPTH_PACKING: BasicDepthPacking },
      uniforms: {
        tDepth: { value: null },
        uProjInv: { value: new Matrix4() },
        uViewInv: { value: new Matrix4() },
        uSunDir: { value: new Vector3() },
      },
      vertexShader,
      fragmentShader: maskFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.blurMaterial = new ShaderMaterial({
      name: 'ShaftBlur',
      defines: { SHAFT_SAMPLES: tier === 'high' ? 48 : 32 },
      uniforms: {
        tMask: { value: this.mask.texture },
        uSunUv: { value: new Vector2() },
        uDensity: { value: 0.9 },
        uDecay: { value: 0.965 },
      },
      vertexShader,
      fragmentShader: blurFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = new ShaderMaterial({
      name: 'ShaftComposite',
      uniforms: {
        inputBuffer: { value: null },
        tShafts: { value: this.shafts.texture },
        uColor: { value: new Color() },
        uIntensity: { value: 0 },
      },
      vertexShader,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.compositeMaterial;
  }

  /** Direction towards the sun, its colour, and the preset's shaft strength (0 turns them off). */
  setSun(dir: Vector3, color: Color, strength: number) {
    this.sunDir.copy(dir).normalize();
    this.compositeMaterial.uniforms.uColor.value.copy(color);
    this.strength = strength;
  }

  override setDepthTexture(depthTexture: Texture | null, depthPacking: DepthPackingStrategies = BasicDepthPacking) {
    this.maskMaterial.uniforms.tDepth.value = depthTexture;
    if (this.maskMaterial.defines.DEPTH_PACKING !== depthPacking) {
      this.maskMaterial.defines.DEPTH_PACKING = depthPacking;
      this.maskMaterial.needsUpdate = true;
    }
  }

  override setSize(width: number, height: number) {
    const w = Math.max(1, Math.round(width / 2));
    const h = Math.max(1, Math.round(height / 2));
    this.mask.setSize(w, h);
    this.shafts.setSize(w, h);
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget) {
    const cam = this.viewCamera;
    this.forward.set(0, 0, -1).transformDirection(cam.matrixWorld);
    const intensity = this.strength * shaftStrength(this.sunDir, this.forward);
    const c = this.compositeMaterial.uniforms;
    c.inputBuffer.value = inputBuffer.texture;
    c.uIntensity.value = intensity;
    if (intensity > 0.001) {
      const m = this.maskMaterial.uniforms;
      m.uProjInv.value.copy(cam.projectionMatrixInverse);
      m.uViewInv.value.copy(cam.matrixWorld);
      m.uSunDir.value.copy(this.sunDir);
      this.sunPoint.setFromMatrixPosition(cam.matrixWorld).addScaledVector(this.sunDir, 1000).project(cam);
      this.blurMaterial.uniforms.uSunUv.value.set(this.sunPoint.x * 0.5 + 0.5, this.sunPoint.y * 0.5 + 0.5);
      this.fullscreenMaterial = this.maskMaterial;
      renderer.setRenderTarget(this.mask);
      renderer.render(this.scene, this.camera);
      this.fullscreenMaterial = this.blurMaterial;
      renderer.setRenderTarget(this.shafts);
      renderer.render(this.scene, this.camera);
    }
    this.fullscreenMaterial = this.compositeMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }

  override dispose() {
    this.mask.dispose();
    this.shafts.dispose();
    for (const m of [this.maskMaterial, this.blurMaterial, this.compositeMaterial]) m.dispose();
    super.dispose();
  }
}
