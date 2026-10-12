import { EventDispatcher, PerspectiveCamera, Scene, Texture, Vector2 } from 'three';
import { createPhotoSession, type PhotoDeps, type TracerLike } from '../src/phototrace/session';
import { PHOTO_MESSAGES, checkPhotoSupport } from '../src/phototrace/support';

const glWith = (float: boolean) =>
  ({
    getExtension: (name: string) => (float && name === 'EXT_color_buffer_float' ? {} : null),
  }) as unknown as WebGL2RenderingContext;

test('no float buffers → a clear refusal', () => {
  expect(checkPhotoSupport(glWith(false), true)).toEqual({
    ok: false,
    message: 'Photo mode needs floating-point render targets (EXT_color_buffer_float), which this GPU does not offer.',
  });
});

test('no worker → a clear refusal', () => {
  expect(checkPhotoSupport(glWith(true), false)).toEqual({
    ok: false,
    message: 'Photo mode could not start its scene worker. Try reloading the page.',
  });
  expect(checkPhotoSupport(glWith(true), true)).toEqual({ ok: true });
});

function harness(over: Partial<PhotoDeps> = {}) {
  const log = {
    inputs: [] as (Texture | null)[],
    active: [] as boolean[],
    errors: [] as string[],
    disposed: 0,
    cameraUpdates: 0,
  };
  const canvas = new EventDispatcher<{ webglcontextlost: object }>();
  const tracer: TracerLike = {
    samples: 0,
    renderSample() {
      this.samples++;
    },
    reset() {
      this.samples = 0;
    },
    updateCamera() {
      log.cameraUpdates++;
      this.samples = 0;
    },
    setSceneAsync: async () => {},
    dispose() {},
  };
  const camera = new PerspectiveCamera(50, 1.5, 1, 1000);
  const photoCamera = Object.assign(new PerspectiveCamera(), { fStop: 8, focusDistance: 100, apertureBlades: 6 });
  const deps: PhotoDeps = {
    renderer: {
      getContext: () => glWith(true),
      getRenderTarget: () => null,
      setRenderTarget() {},
      clear() {},
      getDrawingBufferSize: (v: Vector2) => v.set(640, 360),
      domElement: canvas as unknown as HTMLCanvasElement,
    },
    camera,
    setInput: t => log.inputs.push(t),
    buildScene: () => ({ scene: new Scene(), triangles: 10, dispose: () => log.disposed++ }),
    environment: () => new Texture(),
    loadTracer: async () => ({ tracer, camera: photoCamera }),
    canWorker: () => true,
    onActive: a => log.active.push(a),
    onError: m => log.errors.push(m),
    ...over,
  };
  return { session: createPhotoSession(deps), log, tracer, camera, canvas };
}

test('entering traces up to 256 samples, then holds the frame', async () => {
  const { session, log, tracer } = harness();
  expect(await session.enter()).toEqual({ ok: true });
  expect(log.active).toEqual([true]);
  for (let i = 0; i < 300; i++) session.frame();
  expect(tracer.samples).toBe(256);
  expect(session.status()).toEqual({ phase: 'tracing', samples: 256, target: 256 });
  expect(log.inputs.at(-1)).not.toBeNull();
});

test('moving the camera restarts accumulation', async () => {
  const { session, log, tracer, camera } = harness();
  await session.enter();
  for (let i = 0; i < 40; i++) session.frame();
  expect(tracer.samples).toBe(40);
  camera.position.x += 2;
  camera.updateMatrixWorld();
  session.frame();
  expect(log.cameraUpdates).toBeGreaterThan(0);
  expect(tracer.samples).toBe(1);
});

test('leaving during the build cancels it', async () => {
  let release: () => void = () => {};
  const { session, log } = harness({
    loadTracer: () =>
      new Promise(r => {
        release = () =>
          r({
            tracer: {
              samples: 0,
              renderSample() {},
              reset() {},
              updateCamera() {},
              setSceneAsync: async () => {},
              dispose() {},
            },
            camera: Object.assign(new PerspectiveCamera(), { fStop: 8, focusDistance: 100, apertureBlades: 6 }),
          });
      }),
  });
  const entering = session.enter();
  expect(session.status()?.phase).toBe('building');
  session.exit();
  release();
  expect(await entering).toEqual({ ok: false, message: '' });
  expect(session.status()).toBeNull();
  expect(log.inputs.at(-1) ?? null).toBeNull();
  expect(log.active).toEqual([true, false]);
});

test('a scene that fails to build is reported and nothing stays active', async () => {
  const { session, log } = harness({
    buildScene: () => {
      throw new Error('out of memory');
    },
  });
  expect(await session.enter()).toEqual({ ok: false, message: 'Photo mode could not build the scene: out of memory.' });
  expect(session.status()).toBeNull();
  expect(log.active).toEqual([true, false]);
});

test('without a worker nothing starts', async () => {
  const { session, log } = harness({ canWorker: () => false });
  expect(await session.enter()).toEqual({ ok: false, message: PHOTO_MESSAGES.noWorker });
  expect(log.active).toEqual([]);
});

test('a lost context ends photo mode with a message', async () => {
  const { session, log, canvas } = harness();
  await session.enter();
  canvas.dispatchEvent({ type: 'webglcontextlost' });
  expect(session.status()).toBeNull();
  expect(log.errors).toEqual([PHOTO_MESSAGES.contextLost]);
  expect(log.active.at(-1)).toBe(false);
});

test('a worker that cannot start is reported as such, not as a build error', async () => {
  const { PhotoRefusal } = await import('../src/phototrace/support');
  const { session } = harness({
    loadTracer: async () => {
      throw new PhotoRefusal(PHOTO_MESSAGES.noWorker);
    },
  });
  expect(await session.enter()).toEqual({ ok: false, message: PHOTO_MESSAGES.noWorker });
});
