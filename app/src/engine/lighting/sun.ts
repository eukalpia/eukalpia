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

/** City extent beyond its centre that shadows must still reach: the main island plus a satellite. */
const CITY_REACH = 560;

/** How far the shadow cascades must reach for a camera this far from the city centre. */
export function cascadeFar(distanceToCity: number): number {
  return Math.min(3600, Math.max(420, distanceToCity + CITY_REACH));
}

const CITY_CENTER = new Vector3(0, 60, 0);

export function createSun(parent: Object3D, camera: PerspectiveCamera, tier: QualityTier): SunRig {
  const settings = TIER_SETTINGS[tier];
  const csm = new CSM({
    camera,
    parent,
    cascades: settings.csmCascades,
    shadowMapSize: settings.shadowMapSize,
    maxFar: cascadeFar(1150),
    mode: 'practical',
    lightMargin: 400,
    lightFar: 4000,
    lightIntensity: 4,
    shadowBias: -0.0002,
  });
  // Blend into the next cascade instead of cutting off at a hard line.
  csm.fade = true;
  for (const light of csm.lights) light.shadow.bias = -0.0004;

  // Far cascades cover more meters per shadow texel, so their normal offset grows with their reach.
  function refit(far: number) {
    csm.maxFar = far;
    csm.updateFrustums();
    const halfHeight = Math.tan((camera.fov * Math.PI) / 360);
    csm.lights.forEach((light, i) => {
      const reach = (csm.breaks[i] ?? 1) * far;
      const texel = (2 * reach * halfHeight * Math.max(1, camera.aspect)) / settings.shadowMapSize;
      light.shadow.normalBias = Math.min(3, texel * 1.5);
    });
  }
  refit(csm.maxFar);

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
      // Re-fit when the camera moves between street level and orbit (5 % hysteresis).
      const far = cascadeFar(camera.position.distanceTo(CITY_CENTER));
      if (Math.abs(far - csm.maxFar) / csm.maxFar > 0.05) refit(far);
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
