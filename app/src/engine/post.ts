import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import {
  Color,
  HalfFloatType,
  type Texture,
  Vector2,
  type PerspectiveCamera,
  type Scene,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { DenoisePass } from '../phototrace/denoise';
import { PhotoInputPass } from '../phototrace/photoInputPass';
import { AtmosphereEffect } from './atmosphere/AtmosphereEffect';
import { CloudPass } from './atmosphere/clouds';
import type { DebugFlag } from './debug';
import type { LightingPreset } from './lighting/timeOfDay';
import { TIER_SETTINGS, type QualityTier } from './quality';

export interface PostStack {
  clouds: CloudPass;
  /** Photo mode: feed the path tracer's image in place of the rasterised colour (null returns to raster). */
  setInput(texture: Texture | null): void;
  /** How many path-traced samples the input holds (the denoiser narrows as they grow). */
  setPhotoSamples(samples: number): void;
  setSize(width: number, height: number): void;
  setPreset(p: LightingPreset, sunDir: Vector3): void;
  render(dt: number): void;
  dispose(): void;
}

export function createPost(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  tier: QualityTier,
  flags: ReadonlySet<DebugFlag> = new Set(),
): PostStack {
  const settings = TIER_SETTINGS[tier];
  const composer = new EffectComposer(renderer, { frameBufferType: HalfFloatType });
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);
  const photoInput = new PhotoInputPass(scene, camera);
  photoInput.enabled = false;
  composer.addPass(photoInput);
  const denoise = new DenoisePass(camera);
  denoise.enabled = false;
  composer.addPass(denoise);

  let ao: N8AOPostPass | null = null;
  if (settings.ao !== 'off' && !flags.has('noao')) {
    const size = renderer.getDrawingBufferSize(new Vector2());
    ao = new N8AOPostPass(scene, camera, size.x, size.y);
    ao.configuration.aoRadius = 6;
    ao.configuration.distanceFalloff = 2;
    ao.configuration.intensity = 2.2;
    ao.configuration.halfRes = settings.ao === 'half';
    ao.configuration.gammaCorrection = false;
    composer.addPass(ao);
  }

  const clouds = new CloudPass(camera, tier);
  clouds.enabled = !flags.has('noclouds');
  composer.addPass(clouds);

  // Exposure and fog first, so bloom thresholds and tone mapping see exposed radiance.
  const atmosphere = new AtmosphereEffect(camera);
  composer.addPass(new EffectPass(camera, atmosphere));
  const bloom = new BloomEffect({
    mipmapBlur: true,
    intensity: 0.9,
    luminanceThreshold: 0.95,
    luminanceSmoothing: 0.2,
  });
  if (flags.has('nobloom')) bloom.intensity = 0;
  composer.addPass(new EffectPass(camera, bloom, new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
  const noise = new NoiseEffect({ premultiply: true });
  noise.blendMode.opacity.value = 0.035;
  composer.addPass(
    new EffectPass(camera, new SMAAEffect(), new VignetteEffect({ darkness: 0.38, offset: 0.3 }), noise),
  );

  const fog = new Color();
  const sun = new Color();
  return {
    clouds,
    setInput(texture) {
      renderPass.enabled = texture === null;
      photoInput.enabled = texture !== null;
      photoInput.setPathTexture(texture);
      denoise.enabled = texture !== null;
      // The traced image already holds its own occlusion.
      if (ao) ao.enabled = texture === null;
    },
    setPhotoSamples(samples) {
      denoise.setSamples(samples);
    },
    setSize(width, height) {
      composer.setSize(width, height, false);
    },
    setPreset(p, sunDir) {
      bloom.luminanceMaterial.threshold = p.bloomThreshold;
      bloom.intensity = flags.has('nobloom') ? 0 : p.bloomIntensity;
      atmosphere.setAtmosphere({
        fogColor: fog.set(p.fogColor),
        density: p.fogDensity,
        falloff: p.fogHeightFalloff,
        sunDir,
        sunColor: sun.set(p.sunColor).multiplyScalar(p.sunIntensity * 0.25),
        exposure: p.exposure,
      });
    },
    render(dt) {
      composer.render(dt);
    },
    dispose() {
      composer.dispose();
    },
  };
}
