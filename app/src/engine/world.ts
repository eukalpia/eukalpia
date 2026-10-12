import {
  AgXToneMapping,
  Timer,
  MeshStandardMaterial,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { DISTRICTS } from '../content/districts';
import { captureCityReflection, createCityMeshes, loadWorldTextures } from '../world/city';
import { DEFAULT_SEED, createLayout } from '../world/layout';
import { createTerrain } from '../world/terrain';
import { CHARACTER_SPAWN, createOrbit } from './camera/orbit';
import { loadCharacter, measureBindPose } from '../character/model';
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
  // Timer follows page visibility, so time does not jump after a hidden tab.
  const timer = new Timer();
  timer.connect(document);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 1, 12000);
  const orbit = createOrbit(camera, canvas, { reducedMotion: opts.reducedMotion || !!opts.shot });
  if (opts.shot) orbit.applyPreset(opts.shot);

  const sky = createSky();
  scene.add(sky.mesh);
  const environment = createEnvironment(renderer);
  const sun = createSun(scene, camera, opts.quality);
  const flags = new Set(opts.debug ?? []);
  const post = createPost(renderer, scene, camera, opts.quality, flags);
  const sunDir = new Vector3();
  if (flags.has('noshadow')) for (const light of sun.csm.lights) light.castShadow = false;

  const textures = await loadWorldTextures(renderer, import.meta.env.BASE_URL);
  const layout = createLayout(DEFAULT_SEED, DISTRICTS);
  const city = createCityMeshes(layout, DISTRICTS, { tier: opts.quality, sun, textures });
  scene.add(city.group);

  const terrain = createTerrain(layout, { tier: opts.quality, sun, textures });
  scene.add(terrain.group);

  // UR-01 waits on the sidewalk. A failed download only disables walking; the city keeps running.
  loadCharacter(opts.quality === 'low' ? 'mobile' : 'desktop', import.meta.env.BASE_URL)
    .then(model => {
      if (disposed) return model.dispose();
      model.root.position.set(CHARACTER_SPAWN.x, layout.islands[0].topY, CHARACTER_SPAWN.z);
      for (const m of model.skinned) sun.setupMaterial(m.material as MeshStandardMaterial);
      scene.add(model.root);
      character = model;
      debug.character = () => measureBindPose(model);
    })
    .catch(error => console.warn(String(error)));
  let character: Awaited<ReturnType<typeof loadCharacter>> | null = null;
  let disposed = false;

  // At night the eight lamps nearest to the camera are real lights; the rest glow via the baked ground mask.
  const streetLights = Array.from({ length: 8 }, () => {
    const light = new PointLight(0xffb978, 0, 28, 2);
    scene.add(light);
    return light;
  });
  const lampHeads = terrain.street.lampHeads;
  const nearest: { i: number; d: number }[] = [];
  function updateStreetLights(night: boolean) {
    if (!night) {
      for (const l of streetLights) l.intensity = 0;
      return;
    }
    nearest.length = 0;
    const c = camera.position;
    for (let i = 0; i < lampHeads.length / 3; i++) {
      const dx = lampHeads[i * 3] - c.x;
      const dy = lampHeads[i * 3 + 1] - c.y;
      const dz = lampHeads[i * 3 + 2] - c.z;
      nearest.push({ i, d: dx * dx + dy * dy + dz * dz });
    }
    nearest.sort((a, b) => a.d - b.d);
    streetLights.forEach((light, k) => {
      const lamp = nearest[k];
      if (!lamp) return (light.intensity = 0);
      light.position.set(lampHeads[lamp.i * 3], lampHeads[lamp.i * 3 + 1] - 0.3, lampHeads[lamp.i * 3 + 2]);
      light.intensity = 40;
    });
  }

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
    post.clouds.setPreset(preset, sunDir, time === 'night');
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

  function frame(timestamp?: number) {
    timer.update(timestamp);
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1);
    orbit.update(dt);
    sky.update(timer.getElapsed());
    city.update(dt);
    post.clouds.update(timer.getElapsed());
    terrain.update(timer.getElapsed());
    updateStreetLights(currentTime === 'night');
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
      disposed = true;
      character?.dispose();
      document.removeEventListener('visibilitychange', syncLoop);
      timer.dispose();
      renderer.setAnimationLoop(null);
      orbit.dispose();
      sun.dispose();
      sky.dispose();
      post.dispose();
      city.dispose();
      terrain.dispose();
      reflection?.dispose();
      environment.dispose();
      renderer.dispose();
    },
  };
}
