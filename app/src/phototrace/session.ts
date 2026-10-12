import {
  FloatType,
  Matrix4,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { PhotoScene } from './photoScene';
import { PHOTO_MESSAGES, PhotoRefusal, checkPhotoSupport, type PhotoResult } from './support';

export const PHOTO_TARGET_SAMPLES = 256;

/** The part of WebGLPathTracer the session drives (a fake in tests). */
export interface TracerLike {
  samples: number;
  renderSample(): void;
  reset(): void;
  updateCamera(): void;
  setSceneAsync(scene: Scene, camera: PerspectiveCamera): Promise<unknown>;
  dispose(): void;
}

/** three-gpu-pathtracer's PhysicalCamera: a perspective camera with an aperture. */
export type PhotoCamera = PerspectiveCamera & { fStop: number; focusDistance: number; apertureBlades: number };

export interface PhotoDeps {
  renderer: Pick<
    WebGLRenderer,
    'getContext' | 'getRenderTarget' | 'setRenderTarget' | 'clear' | 'getDrawingBufferSize' | 'domElement'
  >;
  camera: PerspectiveCamera;
  /** post.setInput: the traced image in place of raster colour, null for normal rendering. */
  setInput(texture: Texture | null): void;
  buildScene(): PhotoScene;
  environment(): Texture;
  /** Lazily imports the path tracer and creates it with its BVH worker. */
  loadTracer(): Promise<{ tracer: TracerLike; camera: PhotoCamera }>;
  canWorker(): boolean;
  /** Photo mode started or ended: the world freezes walking input while it is on. */
  onActive(active: boolean): void;
  /** Failures after enter() resolved, e.g. a lost WebGL context. */
  onError(message: string): void;
}

export interface PhotoStatus {
  phase: 'building' | 'tracing';
  samples: number;
  target: number;
}

export interface PhotoSession {
  enter(): Promise<PhotoResult>;
  exit(): void;
  status(): PhotoStatus | null;
  /** Called once per frame by the world while photo mode is on. */
  frame(): void;
  readonly camera: PhotoCamera | null;
  /** Restarts accumulation (after a change of focus or aperture). */
  restart(): void;
  /** The accumulated HDR image, for saving. */
  readonly target: WebGLRenderTarget | null;
  /** Triangles in the traced scene (0 when none is built). */
  readonly triangles: number;
}

export function createPhotoSession(deps: PhotoDeps): PhotoSession {
  let phase: PhotoStatus['phase'] | null = null;
  let run = 0;
  let tracer: TracerLike | null = null;
  let camera: PhotoCamera | null = null;
  let photo: PhotoScene | null = null;
  let environment: Texture | null = null;
  let target: WebGLRenderTarget | null = null;
  const lastView = new Matrix4();
  const lastProjection = new Matrix4();
  const size = new Vector2();

  function teardown() {
    tracer?.dispose();
    photo?.dispose();
    environment?.dispose();
    target?.dispose();
    tracer = null;
    camera = null;
    photo = null;
    environment = null;
    target = null;
  }

  function end(notify: boolean) {
    const wasOn = phase !== null;
    phase = null;
    run++;
    deps.setInput(null);
    teardown();
    if (wasOn && notify) deps.onActive(false);
  }

  const onContextLost = () => {
    if (phase === null) return;
    end(true);
    deps.onError(PHOTO_MESSAGES.contextLost);
  };
  deps.renderer.domElement.addEventListener('webglcontextlost', onContextLost);

  /** Copies the live camera; returns true if anything the path tracer depends on changed. */
  function syncCamera(): boolean {
    const src = deps.camera;
    src.updateMatrixWorld();
    const changed = !lastView.equals(src.matrixWorld) || !lastProjection.equals(src.projectionMatrix);
    if (camera && changed) {
      camera.position.copy(src.position);
      camera.quaternion.copy(src.quaternion);
      camera.fov = src.fov;
      camera.aspect = src.aspect;
      camera.near = src.near;
      camera.far = src.far;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }
    lastView.copy(src.matrixWorld);
    lastProjection.copy(src.projectionMatrix);
    return changed;
  }

  const session: PhotoSession = {
    get camera() {
      return camera;
    },
    get target() {
      return target;
    },
    get triangles() {
      return photo?.triangles ?? 0;
    },
    async enter() {
      if (phase !== null) return { ok: true };
      const support = checkPhotoSupport(deps.renderer.getContext() as WebGL2RenderingContext, deps.canWorker());
      if (!support.ok) return support;
      const mine = ++run;
      phase = 'building';
      deps.onActive(true);
      try {
        const loaded = await deps.loadTracer();
        if (mine !== run) {
          loaded.tracer.dispose();
          return { ok: false, message: '' };
        }
        tracer = loaded.tracer;
        camera = loaded.camera;
        photo = deps.buildScene();
        environment = deps.environment();
        photo.scene.environment = environment;
        photo.scene.background = environment;
        lastView.identity().elements[0] = NaN;
        syncCamera();
        await tracer.setSceneAsync(photo.scene, camera);
        if (mine !== run) return { ok: false, message: '' };
        const { x, y } = deps.renderer.getDrawingBufferSize(size);
        target = new WebGLRenderTarget(x, y, { type: FloatType, depthBuffer: false });
        phase = 'tracing';
        deps.setInput(target.texture);
        return { ok: true };
      } catch (error) {
        if (mine !== run) return { ok: false, message: '' };
        end(true);
        return { ok: false, message: error instanceof PhotoRefusal ? error.message : PHOTO_MESSAGES.build(error) };
      }
    },
    exit() {
      end(true);
    },
    status() {
      if (phase === null) return null;
      return { phase, samples: tracer?.samples ?? 0, target: PHOTO_TARGET_SAMPLES };
    },
    restart() {
      tracer?.reset();
    },
    frame() {
      if (phase !== 'tracing' || !tracer || !target) return;
      const { x, y } = deps.renderer.getDrawingBufferSize(size);
      if (x !== target.width || y !== target.height) {
        target.setSize(x, y);
        tracer.reset();
      }
      if (syncCamera()) tracer.updateCamera();
      if (tracer.samples >= PHOTO_TARGET_SAMPLES) return;
      const previous = deps.renderer.getRenderTarget();
      deps.renderer.setRenderTarget(target);
      deps.renderer.clear();
      tracer.renderSample();
      deps.renderer.setRenderTarget(previous);
    },
  };
  return session;
}
