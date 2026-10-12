export const PHOTO_MESSAGES = {
  noFloat: 'Photo mode needs floating-point render targets (EXT_color_buffer_float), which this GPU does not offer.',
  noWorker: 'Photo mode could not start its scene worker. Try reloading the page.',
  contextLost: 'Photo mode lost the graphics context. The city is back in normal mode.',
  build: (error: unknown) =>
    `Photo mode could not build the scene: ${error instanceof Error ? error.message : String(error)}.`,
} as const;

export type PhotoResult = { ok: true } | { ok: false; message: string };

/** Whether this browser can run the path tracer: float render targets and a Web Worker for the BVH. */
export function checkPhotoSupport(gl: WebGL2RenderingContext | null, canWorker: boolean): PhotoResult {
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return { ok: false, message: PHOTO_MESSAGES.noFloat };
  if (!canWorker) return { ok: false, message: PHOTO_MESSAGES.noWorker };
  return { ok: true };
}

/** A failure whose message is already meant for the person using the site. */
export class PhotoRefusal extends Error {}
