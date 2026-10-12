import { Pass } from 'postprocessing';
import {
  BasicDepthPacking,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type DepthPackingStrategies,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';

// Edge stops: normals (1 − cos), relative depth, and luminance that narrows as samples converge.
const SIGMA_NORMAL = 0.1;
const SIGMA_DEPTH = 0.02;
const SIGMA_LUMA = 0.8;

/** Weight of a neighbour in the à-trous filter (TS mirror of the GLSL below). */
export function denoiseWeight(dn: number, dz: number, dl: number, samples: number): number {
  const sl = SIGMA_LUMA / Math.sqrt(Math.max(1, samples));
  return Math.exp(-dn / SIGMA_NORMAL) * Math.exp(-dz / SIGMA_DEPTH) * Math.exp(-(dl * dl) / (2 * sl * sl));
}

export const DENOISE_GLSL = /* glsl */ `
/*denoise:weight*/
float denoiseWeight(float dn, float dz, float dl, float samples) {
  float sl = ${SIGMA_LUMA.toFixed(3)} / sqrt(max(1.0, samples));
  return exp(-dn / ${SIGMA_NORMAL.toFixed(3)}) * exp(-dz / ${SIGMA_DEPTH.toFixed(3)}) * exp(-(dl * dl) / (2.0 * sl * sl));
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uStep;
uniform float uSamples;
uniform float uNear;
uniform float uFar;
uniform mat4 uProjInv;
varying vec2 vUv;

${DENOISE_GLSL}

float readDepth(vec2 uv) {
#if DEPTH_PACKING == 3201
  return unpackRGBAToDepth(texture2D(tDepth, uv));
#else
  return texture2D(tDepth, uv).r;
#endif
}

vec3 viewPos(vec2 uv) {
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, readDepth(uv) * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

vec3 viewNormal(vec2 uv) {
  vec3 c = viewPos(uv);
  vec3 dx = viewPos(uv + vec2(uTexel.x, 0.0)) - c;
  vec3 dy = viewPos(uv + vec2(0.0, uTexel.y)) - c;
  return normalize(cross(dx, dy));
}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 centre = texture2D(tColor, vUv).rgb;
  float depth = readDepth(vUv);
  // The sky has no surface to guide the filter; leave it alone.
  if (depth >= 0.999999) { gl_FragColor = vec4(centre, 1.0); return; }
  vec3 n = viewNormal(vUv);
  float z = -viewPos(vUv).z;
  float l = luma(centre);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  const float kernel[3] = float[3](0.375, 0.25, 0.0625);
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec2 uv = vUv + vec2(float(i), float(j)) * uTexel * uStep;
      vec3 c = texture2D(tColor, uv).rgb;
      float k = kernel[abs(i)] * kernel[abs(j)];
      float dn = 1.0 - max(dot(n, viewNormal(uv)), 0.0);
      float dz = abs(-viewPos(uv).z - z) / max(z, 1e-3);
      float w = k * denoiseWeight(dn, dz, abs(luma(c) - l), uSamples);
      sum += c * w;
      total += w;
    }
  }
  gl_FragColor = vec4(sum / max(total, 1e-6), 1.0);
}
`;

/** Edge-aware à-trous filter (steps 1, 2, 4) over the traced image, guided by the raster depth. */
export class DenoisePass extends Pass {
  readonly filterMaterial: ShaderMaterial;
  private readonly viewCamera: PerspectiveCamera;
  private readonly a = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private readonly b = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });

  constructor(camera: PerspectiveCamera) {
    super('DenoisePass');
    this.viewCamera = camera;
    this.needsDepthTexture = true;
    for (const t of [this.a, this.b]) t.texture.minFilter = t.texture.magFilter = LinearFilter;
    this.filterMaterial = new ShaderMaterial({
      name: 'Denoise',
      defines: { DEPTH_PACKING: BasicDepthPacking },
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uTexel: { value: new Vector2() },
        uStep: { value: 1 },
        uSamples: { value: 1 },
        uNear: { value: 1 },
        uFar: { value: 1000 },
        uProjInv: { value: new Matrix4() },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.filterMaterial;
  }

  setSamples(samples: number) {
    this.filterMaterial.uniforms.uSamples.value = samples;
  }

  override setDepthTexture(depthTexture: Texture | null, depthPacking: DepthPackingStrategies = BasicDepthPacking) {
    this.filterMaterial.uniforms.tDepth.value = depthTexture;
    if (this.filterMaterial.defines.DEPTH_PACKING !== depthPacking) {
      this.filterMaterial.defines.DEPTH_PACKING = depthPacking;
      this.filterMaterial.needsUpdate = true;
    }
  }

  override setSize(width: number, height: number) {
    this.a.setSize(width, height);
    this.b.setSize(width, height);
    this.filterMaterial.uniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget) {
    const u = this.filterMaterial.uniforms;
    u.uProjInv.value.copy(this.viewCamera.projectionMatrixInverse);
    u.uNear.value = this.viewCamera.near;
    u.uFar.value = this.viewCamera.far;
    // Never draw into the buffer whose depth we read: input → a → b → output.
    const passes: [Texture, WebGLRenderTarget | null][] = [
      [inputBuffer.texture, this.a],
      [this.a.texture, this.b],
      [this.b.texture, this.renderToScreen ? null : outputBuffer],
    ];
    passes.forEach(([source, target], i) => {
      u.tColor.value = source;
      u.uStep.value = 1 << i;
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
    });
  }

  override dispose() {
    this.a.dispose();
    this.b.dispose();
    this.filterMaterial.dispose();
    super.dispose();
  }
}
