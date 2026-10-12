import { Pass } from 'postprocessing';
import {
  ShaderMaterial,
  type Camera,
  type Scene,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

/**
 * Stands in for the RenderPass in photo mode: rasterises the live scene so later passes (fog, clouds,
 * denoise) keep their depth, then replaces the colour with the path tracer's accumulated image.
 */
export class PhotoInputPass extends Pass {
  readonly copyMaterial: ShaderMaterial;
  private readonly rasterScene: Scene;
  private readonly rasterCamera: Camera;

  constructor(scene: Scene, camera: Camera) {
    super('PhotoInputPass');
    this.rasterScene = scene;
    this.rasterCamera = camera;
    this.needsSwap = false;
    this.copyMaterial = new ShaderMaterial({
      name: 'PhotoCopy',
      uniforms: { tPath: { value: null } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tPath;
        varying vec2 vUv;
        void main() { gl_FragColor = vec4(texture2D(tPath, vUv).rgb, 1.0); }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.fullscreenMaterial = this.copyMaterial;
  }

  setPathTexture(texture: Texture | null) {
    this.copyMaterial.uniforms.tPath.value = texture;
  }

  override render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget) {
    const autoClear = renderer.autoClear;
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer);
    renderer.autoClear = true;
    renderer.render(this.rasterScene, this.rasterCamera);
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  override dispose() {
    this.copyMaterial.dispose();
    super.dispose();
  }
}
