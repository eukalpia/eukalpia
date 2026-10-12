import {
  CubeCamera,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  HalfFloatType,
  LinearFilter,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/** Direction for an equirect texel, the inverse of three.js `equirectUv` (u from atan(z, x), v from asin(y)). */
export const EQUIRECT_GLSL = /* glsl */ `
/*equirect:direction*/
vec3 equirectDirection(vec2 uv) {
  float theta = (uv.x - 0.5) * 6.283185307179586;
  float phi = (uv.y - 0.5) * 3.141592653589793;
  return vec3(cos(phi) * cos(theta), sin(phi), cos(phi) * sin(theta));
}
`;

export function equirectDirection(u: number, v: number, target: Vector3): Vector3 {
  const theta = (u - 0.5) * Math.PI * 2;
  const phi = (v - 0.5) * Math.PI;
  return target.set(Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta));
}

export function directionToEquirect(dir: Vector3): [number, number] {
  return [Math.atan2(dir.z, dir.x) / (Math.PI * 2) + 0.5, Math.asin(Math.max(-1, Math.min(1, dir.y))) / Math.PI + 0.5];
}

/** Samples a cube render target along each equirect texel's direction. */
export function equirectMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CubeToEquirect',
    uniforms: { tCube: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform samplerCube tCube;
      varying vec2 vUv;
      ${EQUIRECT_GLSL}
      void main() { gl_FragColor = vec4(textureCube(tCube, equirectDirection(vUv)).rgb, 1.0); }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * Renders the sky (day Sky shader or the night sky) into an HDR equirect DataTexture. The path tracer
 * needs the texels on the CPU to build its importance-sampling tables, so the result is read back.
 */
export function skyToEquirect(renderer: WebGLRenderer, sky: Object3D, size = 1024): DataTexture {
  const width = size;
  const height = size / 2;
  const cube = new WebGLCubeRenderTarget(size / 2, { type: HalfFloatType });
  const cubeCamera = new CubeCamera(1, 1e6, cube);
  const target = new WebGLRenderTarget(width, height, { type: FloatType, depthBuffer: false });
  const material = equirectMaterial();
  const quad = new FullScreenQuad(material);
  const previous = renderer.getRenderTarget();
  try {
    cubeCamera.update(renderer, sky);
    material.uniforms.tCube.value = cube.texture;
    renderer.setRenderTarget(target);
    quad.render(renderer);
    const data = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, width, height, data);
    const tex = new DataTexture(data, width, height, RGBAFormat, FloatType);
    tex.mapping = EquirectangularReflectionMapping;
    tex.minFilter = tex.magFilter = LinearFilter;
    tex.needsUpdate = true;
    return tex;
  } finally {
    renderer.setRenderTarget(previous);
    quad.dispose();
    material.dispose();
    target.dispose();
    cube.dispose();
  }
}
