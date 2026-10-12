import {
  AgXToneMapping,
  Clock,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { DISTRICTS } from '../content/districts';
import { captureCityReflection, createCityMeshes, loadWorldTextures } from '../world/city';
import { DEFAULT_SEED, createLayout } from '../world/layout';
import { createTerrain } from '../world/terrain';
import { createClouds } from './atmosphere/clouds';
import { createOrbit } from './camera/orbit';
import { installDebug, type DebugFlag, type DebugHandle, type ShotName } from './debug';
import { createEnvironment } from './lighting/environment';
import { createSky } from './lighting/sky';
import { createSun } from './lighting/sun';
import { PRESETS, sunDirection, type TimeOfDay } from './lighting/timeOfDay';
import { createPost } from './post';
import { AdaptiveResolution, BUDGETS, TIER_SETTINGS, type QualityTier } from './quality';

export type { QualityTier } from './quality';
export type { TimeOfDay } from './lighting/timeOfDay';

export interface WorldOptions {
  quality: QualityTier;
  time: TimeOfDay;
  shot?: ShotName;
  reducedMotion: boolean;
  debug?: DebugFlag[];
}

export interface World {
  setTime(time: TimeOfDay): void;
  resize(width: number, height: number): void;
  dispose(): void;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}

export async function createWorld(canvas: HTMLCanvasElement, opts: WorldOptions): Promise<World> {
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  // Tone mapping and exposure happen in the post stack.
  renderer.toneMapping = NoToneMapping;
  const settings = TIER_SETTINGS[opts.quality];
  const budget = BUDGETS[opts.quality];
  // Shots render at a fixed DPR of 1: the software rasterizer would otherwise trip the adaptive scaler.
  const adaptive = opts.shot ? null : new AdaptiveResolution(Math.min(window.devicePixelRatio || 1, settings.maxDpr));
  renderer.setPixelRatio(opts.shot ? 1 : Math.min(window.devicePixelRatio || 1, settings.maxDpr));
  const clock = new Clock();

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 1, 12000);
  const orbit = createOrbit(camera, canvas, { reducedMotion: opts.reducedMotion || !!opts.shot });
  if (opts.shot) orbit.applyPreset(opts.shot);

  const sky = createSky();
  scene.add(sky.mesh);
  const environment = createEnvironment(renderer);
  const sun = createSun(scene, camera, opts.quality);
  const clouds = createClouds(opts.quality);
  scene.add(clouds.mesh);
  const flags = new Set(opts.debug ?? []);
  const post = createPost(renderer, scene, camera, opts.quality, flags);
  const sunDir = new Vector3();
  if (flags.has('noclouds')) clouds.mesh.visible = false;
  if (flags.has('noshadow')) for (const light of sun.csm.lights) light.castShadow = false;

  const textures = await loadWorldTextures(renderer, import.meta.env.BASE_URL);
  const layout = createLayout(DEFAULT_SEED, DISTRICTS);
  const city = createCityMeshes(layout, DISTRICTS, { tier: opts.quality, sun, textures });
  scene.add(city.group);

  const terrain = createTerrain(layout, { tier: opts.quality, sun, textures });
  scene.add(terrain.group);

  // Glass reflects a capture of the city taken from the ring-avenue crossing next to the monolith.
  const reflectionPoint = new Vector3(56, 60, 56);
  let reflection: { texture: Texture; dispose(): void } | null = null;

  let currentTime = opts.time;
  function setTime(time: TimeOfDay) {
    currentTime = time;
    const preset = PRESETS[time];
    sky.setPreset(preset, time);
    sun.setPreset(preset);
    scene.environment = environment.update(sky.mesh);
    scene.environmentIntensity = preset.envIntensity;
    sunDirection(preset, sunDir);
    clouds.setPreset(preset, sunDir, time === 'night');
    post.setPreset(flags.has('nofog') ? { ...preset, fogDensity: 0 } : preset, sunDir);
    city.setNight(time === 'night', preset.windowLitRatio);
    terrain.setNight(time === 'night');
    sun.update();
    city.facade.envMap = null;
    reflection?.dispose();
    reflection = flags.has('noreflect') ? null : captureCityReflection(renderer, scene, reflectionPoint);
    city.facade.envMap = reflection?.texture ?? null;
    city.facade.envMapIntensity = preset.envIntensity;
  }
  setTime(opts.time);

  const debug: DebugHandle = installDebug(() => {
    const { calls, triangles } = renderer.info.render;
    return {
      drawCalls: calls,
      triangles,
      dpr: renderer.getPixelRatio(),
      tier: opts.quality,
      budget,
      withinBudget: calls <= budget.drawCalls && triangles <= budget.triangles,
    };
  });

  function frame() {
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
    orbit.update(dt);
    sky.update(clock.elapsedTime);
    city.update(dt);
    clouds.update(clock.elapsedTime);
    terrain.update(clock.elapsedTime);
    sun.update();
    renderer.info.reset();
    if (flags.has('nopost')) {
      renderer.toneMapping = AgXToneMapping;
      renderer.toneMappingExposure = PRESETS[currentTime].exposure;
      renderer.render(scene, camera);
    } else post.render(dt);
    debug.frame += 1;
    if (debug.frame >= 2) debug.ready = true;
    // Frame time is the real interval between frames, so GPU-bound slowness is included.
    const nextDpr = adaptive?.update(rawDt * 1000, dt);
    if (nextDpr) {
      renderer.setPixelRatio(nextDpr);
      resize(size.width, size.height);
    }
  }

  // Rendering stops while the tab is hidden and resumes when it is shown again.
  const syncLoop = () => renderer.setAnimationLoop(document.hidden ? null : frame);
  document.addEventListener('visibilitychange', syncLoop);
  syncLoop();

  const size = { width: 1, height: 1 };
  function resize(width: number, height: number) {
    size.width = width;
    size.height = height;
    renderer.setSize(width, height, false);
    post.setSize(width, height);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    sun.csm.updateFrustums();
  }
  resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);

  return {
    renderer,
    scene,
    camera,
    resize,
    setTime,
    dispose() {
      document.removeEventListener('visibilitychange', syncLoop);
      renderer.setAnimationLoop(null);
      orbit.dispose();
      sun.dispose();
      sky.dispose();
      clouds.dispose();
      post.dispose();
      city.dispose();
      terrain.dispose();
      reflection?.dispose();
      environment.dispose();
      renderer.dispose();
    },
  };
}
