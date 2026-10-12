import {
  AgXToneMapping,
  BoxGeometry,
  Clock,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { createOrbit } from './camera/orbit';
import { installDebug, type DebugHandle, type ShotName } from './debug';
import { createEnvironment } from './lighting/environment';
import { createSky } from './lighting/sky';
import { createSun } from './lighting/sun';
import { PRESETS, type TimeOfDay } from './lighting/timeOfDay';
import { AdaptiveResolution, BUDGETS, TIER_SETTINGS, type QualityTier } from './quality';

export type { QualityTier } from './quality';
export type { TimeOfDay } from './lighting/timeOfDay';

export interface WorldOptions {
  quality: QualityTier;
  time: TimeOfDay;
  shot?: ShotName;
  reducedMotion: boolean;
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
  renderer.toneMapping = AgXToneMapping;
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

  // Temporary stand-in geometry until the city is generated.
  const groundMaterial = new MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.9 });
  const blockMaterial = new MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.7 });
  sun.setupMaterial(groundMaterial);
  sun.setupMaterial(blockMaterial);
  const ground = new Mesh(new PlaneGeometry(600, 600).rotateX(-Math.PI / 2), groundMaterial);
  ground.receiveShadow = true;
  const block = new Mesh(new BoxGeometry(40, 40, 40).translate(0, 20, 0), blockMaterial);
  block.castShadow = block.receiveShadow = true;
  scene.add(ground, block);

  function setTime(time: TimeOfDay) {
    const preset = PRESETS[time];
    sky.setPreset(preset, time);
    sun.setPreset(preset);
    scene.environment = environment.update(sky.mesh);
    scene.environmentIntensity = preset.envIntensity;
    renderer.toneMappingExposure = preset.exposure;
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
    sun.update();
    renderer.info.reset();
    renderer.render(scene, camera);
    debug.frame += 1;
    if (debug.frame >= 2) debug.ready = true;
    // Frame time is the real interval between frames, so GPU-bound slowness is included.
    const nextDpr = adaptive?.update(rawDt * 1000, dt);
    if (nextDpr) renderer.setPixelRatio(nextDpr);
  }

  // Rendering stops while the tab is hidden and resumes when it is shown again.
  const syncLoop = () => renderer.setAnimationLoop(document.hidden ? null : frame);
  document.addEventListener('visibilitychange', syncLoop);
  syncLoop();

  function resize(width: number, height: number) {
    renderer.setSize(width, height, false);
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
      environment.dispose();
      renderer.dispose();
    },
  };
}
