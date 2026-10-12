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
import { createTraffic } from '../world/street/traffic';
import { planClutter } from '../world/street/clutter';
import { createClutterMeshes } from '../world/street/clutterMeshes';
import { CHARACTER_SPAWN, createOrbit } from './camera/orbit';
import { loadCharacter, measureBindPose } from '../character/model';
import { createWalk, type Walk } from '../character/walk';
import type { Sector } from '../app/url';
import { buildCollisionWorld } from '../world/collision';
import { createLift, liftColliders, planLift, type LiftStatus } from '../world/lift';
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
  sector?: Sector;
}

export type WorldMode = 'orbit' | 'walk';

export interface World {
  setTime(time: TimeOfDay): void;
  /** Switches between the orbit overview and walking with UR-01; false if walking is not available yet. */
  setMode(mode: WorldMode): boolean;
  mode(): WorldMode;
  /** The LMS lift as seen from where UR-01 stands; null while not walking. */
  liftStatus(): LiftStatus | null;
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
  const clutterPlan = planClutter(layout, city.specs);
  const clutter = createClutterMeshes(clutterPlan, { sun });
  scene.add(clutter.group);
  const traffic = createTraffic(layout, city.specs, terrain.street, {
    sun,
    cars: { high: 260, medium: 160, low: 60 }[opts.quality],
    crossings: clutterPlan.crossings,
  });
  scene.add(traffic.group);
  // Signals and the cars that obey them share one clock, which stops while the tab is hidden.
  let streetClock = 0;

  // The panoramic lift up the LMS tower, and the solid city UR-01 walks in.
  const lmsId = DISTRICTS.find(d => d.name === 'lms.turin.uz')!.id;
  const liftPlan = planLift(
    city.specs.find(s => s.districtId === lmsId)!,
    layout,
  );
  const collision = buildCollisionWorld(
    layout,
    city.specs,
    terrain.furniture,
    clutterPlan.signals,
    liftColliders(liftPlan),
  );
  const lift = createLift(liftPlan, collision, { sun });
  scene.add(lift.group);

  // UR-01 waits on the sidewalk. A failed download only disables walking; the city keeps running.
  loadCharacter(opts.quality === 'low' ? 'mobile' : 'desktop', import.meta.env.BASE_URL)
    .then(model => {
      if (disposed) return model.dispose();
      model.root.position.set(CHARACTER_SPAWN.x, layout.islands[0].topY, CHARACTER_SPAWN.z);
      for (const m of model.skinned) sun.setupMaterial(m.material as MeshStandardMaterial);
      scene.add(model.root);
      character = model;
      debug.character = () => measureBindPose(model);
      walk = createWalk({
        camera,
        canvas,
        world: collision,
        model,
        spawn: new Vector3(CHARACTER_SPAWN.x, layout.islands[0].topY, CHARACTER_SPAWN.z),
      });
      walk.onAction(a => a === 'exit' && setMode('orbit'));
      walk.onAction(a => a === 'transit' && lift.press(walk!.controller.position));
      if (opts.sector === 'street' && !opts.shot) setMode('walk');
    })
    .catch(error => console.warn(String(error)));
  let character: Awaited<ReturnType<typeof loadCharacter>> | null = null;
  let walk: Walk | null = null;
  let disposed = false;
  let mode: WorldMode = 'orbit';
  function setMode(next: WorldMode): boolean {
    if (next === 'walk' && !walk) return false;
    if (next === mode) return true;
    mode = next;
    if (next === 'walk') {
      orbit.controls.enabled = false;
      camera.near = 0.15;
      camera.far = 6000;
      walk!.enter();
    } else {
      walk?.exit();
      camera.near = 1;
      camera.far = 12000;
      camera.fov = 40;
      orbit.home();
    }
    camera.updateProjectionMatrix();
    sun.csm.updateFrustums();
    return true;
  }

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
    traffic.setNight(time === 'night');
    clutter.setNight(time === 'night');
    lift.setNight(time === 'night');
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
    lift.update(dt, walk?.active ? walk.controller : undefined);
    if (walk?.active) walk.update(dt);
    else {
      orbit.update(dt);
      walk?.idle(dt, flags.has('walkcycle') ? 1.6 : 0);
    }
    sky.update(timer.getElapsed());
    city.update(dt);
    post.clouds.update(timer.getElapsed());
    terrain.update(timer.getElapsed());
    streetClock += dt;
    traffic.update(dt, streetClock);
    clutter.update(streetClock);
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
    setMode,
    mode: () => mode,
    liftStatus: () => (walk?.active ? lift.status(walk.controller.position) : null),
    dispose() {
      disposed = true;
      walk?.dispose();
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
      traffic.dispose();
      clutter.dispose();
      lift.dispose();
      reflection?.dispose();
      environment.dispose();
      renderer.dispose();
    },
  };
}
