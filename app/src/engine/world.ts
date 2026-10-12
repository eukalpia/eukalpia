import { Clock, Color, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { installDebug, type DebugHandle, type ShotName } from './debug';
import { AdaptiveResolution, BUDGETS, TIER_SETTINGS, type QualityTier } from './quality';

export type { QualityTier } from './quality';
export type TimeOfDay = 'day' | 'night';

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
  const settings = TIER_SETTINGS[opts.quality];
  const budget = BUDGETS[opts.quality];
  // Shots render at a fixed DPR of 1: the software rasterizer would otherwise trip the adaptive scaler.
  const adaptive = opts.shot ? null : new AdaptiveResolution(Math.min(window.devicePixelRatio || 1, settings.maxDpr));
  renderer.setPixelRatio(opts.shot ? 1 : Math.min(window.devicePixelRatio || 1, settings.maxDpr));
  const clock = new Clock();

  const scene = new Scene();
  scene.background = new Color(opts.time === 'night' ? 0x070b12 : 0x9fbad3);
  const camera = new PerspectiveCamera(40, 1, 1, 12000);
  camera.position.set(720, 420, 780);
  camera.lookAt(0, 40, 0);

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
    const dt = Math.min(clock.getDelta(), 0.1);
    const started = performance.now();
    renderer.info.reset();
    renderer.render(scene, camera);
    debug.frame += 1;
    if (debug.frame >= 2) debug.ready = true;
    const nextDpr = adaptive?.update(performance.now() - started, dt);
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
  }
  resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);

  return {
    renderer,
    scene,
    camera,
    resize,
    setTime(time) {
      scene.background = new Color(time === 'night' ? 0x070b12 : 0x9fbad3);
    },
    dispose() {
      document.removeEventListener('visibilitychange', syncLoop);
      renderer.setAnimationLoop(null);
      renderer.dispose();
    },
  };
}
