declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import { Pass } from 'postprocessing';

  export interface N8AOConfiguration {
    aoRadius: number;
    distanceFalloff: number;
    intensity: number;
    halfRes: boolean;
    gammaCorrection: boolean;
    aoSamples: number;
    denoiseSamples: number;
    denoiseRadius: number;
    screenSpaceRadius: boolean;
  }

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
  }
}
