import { Mesh, PMREMGenerator, Scene, type Texture, type WebGLRenderer, type WebGLRenderTarget } from 'three';

export interface EnvironmentRig {
  /** Re-bakes image-based lighting from the current sky. */
  update(sky: Mesh): Texture;
  dispose(): void;
}

export function createEnvironment(renderer: WebGLRenderer): EnvironmentRig {
  const pmrem = new PMREMGenerator(renderer);
  const bakeScene = new Scene();
  let target: WebGLRenderTarget | null = null;

  return {
    update(sky) {
      const clone = new Mesh(sky.geometry, sky.material);
      clone.scale.copy(sky.scale);
      bakeScene.clear();
      bakeScene.add(clone);
      target?.dispose();
      target = pmrem.fromScene(bakeScene, 0.02, 1, 20000);
      return target.texture;
    },
    dispose() {
      target?.dispose();
      pmrem.dispose();
    },
  };
}
