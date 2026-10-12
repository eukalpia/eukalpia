import { Color, type Material, type Object3D, type PerspectiveCamera, Vector3 } from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { TIER_SETTINGS, type QualityTier } from '../quality';
import { sunDirection, type LightingPreset } from './timeOfDay';

export interface SunRig {
  csm: CSM;
  setPreset(p: LightingPreset): void;
  update(): void;
  /** Hooks cascaded shadows into a material while keeping its own onBeforeCompile. */
  setupMaterial(material: Material): void;
  dispose(): void;
}

export function createSun(parent: Object3D, camera: PerspectiveCamera, tier: QualityTier): SunRig {
  const settings = TIER_SETTINGS[tier];
  const csm = new CSM({
    camera,
    parent,
    cascades: settings.csmCascades,
    shadowMapSize: settings.shadowMapSize,
    maxFar: 1400,
    mode: 'practical',
    lightMargin: 400,
    lightFar: 4000,
    lightIntensity: 4,
    shadowBias: -0.0002,
  });
  // Far cascades cover more meters per shadow texel, so they need a larger normal offset.
  const normalBias = [0.12, 0.35, 0.8, 1.6];
  csm.lights.forEach((light, i) => {
    light.shadow.normalBias =
      normalBias[Math.min(i, normalBias.length - 1)] * (settings.shadowMapSize === 1024 ? 2 : 1);
    light.shadow.bias = -0.0004;
  });

  const dir = new Vector3();
  const color = new Color();

  return {
    csm,
    setPreset(p) {
      sunDirection(p, dir);
      csm.lightDirection.copy(dir).negate();
      color.set(p.sunColor);
      for (const light of csm.lights) {
        light.color.copy(color);
        light.intensity = p.sunIntensity;
      }
    },
    update() {
      csm.update();
    },
    setupMaterial(material) {
      const own = material.onBeforeCompile.bind(material);
      csm.setupMaterial(material);
      const csmHook = material.onBeforeCompile.bind(material);
      material.onBeforeCompile = (shader, renderer) => {
        csmHook(shader, renderer);
        own(shader, renderer);
      };
    },
    dispose() {
      csm.dispose();
      csm.remove();
    },
  };
}
