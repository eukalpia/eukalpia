// Everything photo mode needs that is too heavy for the main chunk; world.ts imports this on first use.
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/worker';
import { PhysicalCamera, WebGLPathTracer } from 'three-gpu-pathtracer';
import type { WebGLRenderer } from 'three';
import type { PhotoCamera, TracerLike } from './session';
import { PHOTO_MESSAGES, PhotoRefusal } from './support';

export { buildPhotoScene } from './photoScene';
export { skyToEquirect } from './environment';

export function createTracer(renderer: WebGLRenderer): { tracer: TracerLike; camera: PhotoCamera } {
  let worker: GenerateMeshBVHWorker;
  try {
    worker = new GenerateMeshBVHWorker();
  } catch {
    throw new PhotoRefusal(PHOTO_MESSAGES.noWorker);
  }
  const tracer = new WebGLPathTracer(renderer);
  tracer.setBVHWorker(worker);
  // Draw into whatever target the session binds: low-res preview first, then the full image fades in.
  tracer.renderToCanvas = true;
  tracer.rasterizeScene = false;
  tracer.dynamicLowRes = true;
  tracer.lowResScale = 0.25;
  tracer.minSamples = 3;
  tracer.renderDelay = 0;
  tracer.fadeDuration = 400;
  tracer.bounces = 6;
  tracer.filterGlossyFactor = 0.5;
  tracer.multipleImportanceSampling = true;
  const camera = new PhysicalCamera() as unknown as PhotoCamera;
  camera.fStop = 8;
  camera.apertureBlades = 6;
  camera.focusDistance = 250;
  const dispose = tracer.dispose.bind(tracer);
  tracer.dispose = () => {
    dispose();
    worker.dispose();
  };
  return { tracer: tracer as unknown as TracerLike, camera };
}
