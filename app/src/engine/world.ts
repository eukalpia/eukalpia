import {
  AgXToneMapping,
  Box3,
  Color,
  Raycaster,
  Timer,
  Vector2,
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
import { CHARACTER_SPAWN, OVERVIEW_POSE, UNDERWORLD_POSE, createOrbit } from './camera/orbit';
import { loadCharacter, measureBindPose } from '../character/model';
import { upgradeCharacterMaterials } from '../character/materials';
import { createPresence, type Presence } from '../character/presence';
import { focusPose, landmarkFrames } from '../world/landmarks';
import { isClick, pickNearest, type Pickable, type PickTarget } from '../world/picking';
import { createSigns } from '../world/signs';
import { createSecrets, planSecrets } from '../world/secrets';
import { createWalk, type Walk } from '../character/walk';
import type { Sector } from '../app/url';
import { buildCollisionWorld } from '../world/collision';
import { createLift, liftColliders, planLift, type LiftStatus } from '../world/lift';
import { focusDistance } from '../phototrace/focus';
import { createPhotoSession, type PhotoStatus } from '../phototrace/session';
import type { PhotoResult } from '../phototrace/support';
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
  /** Tells the interface when the mode changes, whoever changed it (button, Esc, ?sector=street). */
  onModeChange(fn: (mode: WorldMode) => void): void;
  /** Whether UR-01 can walk yet. */
  walkState(): 'loading' | 'ready' | 'failed';
  /** The LMS lift as seen from where UR-01 stands; null while not walking. */
  liftStatus(): LiftStatus | null;
  /** The overview, floor −1 (under the main island), or street level, which is walking. */
  setSector(sector: Sector): boolean;
  /** Flies to a district's landmark. */
  focusDistrict(id: number): void;
  /** Freezes the city's motion (clouds, sky, traffic, the tour); walking input waits too. */
  setPaused(paused: boolean): void;
  setTour(on: boolean): void;
  /** Told when the tour starts or ends, including when a drag ends it. */
  onTourChange(fn: (on: boolean) => void): void;
  setFly(on: boolean): void;
  setFlyInput(input: { forward: number; right: number; up: number }): void;
  /** v1's pixel vision: a coarse, crisp render (pixel ratio 0.62). */
  setPixelated(on: boolean): void;
  /** The label under the pointer in orbit (a district or a hidden object); null when nothing. */
  onHover(fn: (label: string | null) => void): void;
  /** A click (not a drag) on a district, a hidden object or the air taxi. */
  onPick(fn: (target: PickTarget) => void): void;
  /** Chases UR-07 until a drag or a navigation lets go. */
  followVehicle(): void;
  /** OVERRIDE ACCEPTED: a red sun, red windows and a red beacon cross for the rest of the visit. */
  setOverride(on: boolean): void;
  /** The seven knocks: labels and lit windows go dark for a while. */
  blackout(ms: number): void;
  /** All six found: the monolith's cross turns mint. */
  setCompleted(on: boolean): void;
  /** After its discovery the cat walks its roof. */
  setCatFound(found: boolean): void;
  photo: {
    enter(): Promise<PhotoResult>;
    exit(): void;
    status(): PhotoStatus | null;
    /** Called with a message when photo mode ends on its own (e.g. a lost graphics context). */
    onError(fn: (message: string) => void): void;
    /** Focus on whatever is under a point in normalised device coordinates. */
    focusAt(ndcX: number, ndcY: number): void;
    setAperture(fStop: number): void;
    /** The next composited frame as a PNG. */
    save(): Promise<Blob>;
  };
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
  const landmarks = landmarkFrames(city.specs);
  const signs = createSigns(landmarks, DISTRICTS);
  scene.add(signs.group);
  post.overlay.add(signs.labels);
  const secrets = createSecrets(planSecrets(layout, city.specs), {
    setup: m => sun.setupMaterial(m as MeshStandardMaterial),
  });
  scene.add(secrets.group);
  let override = false;
  let blackoutUntil = 0;
  let blackoutTimer = 0;
  // Everything a click can land on; the hidden objects join later.
  const pickables: Pickable[] = [];
  for (const spec of city.specs) {
    if (spec.districtId === undefined) continue;
    const box = new Box3();
    for (const t of spec.tiers)
      box.union(
        new Box3().set(
          new Vector3(t.cx - t.width / 2, t.y0, t.cz - t.depth / 2),
          new Vector3(t.cx + t.width / 2, t.y1, t.cz + t.depth / 2),
        ),
      );
    const district = DISTRICTS.find(d => d.id === spec.districtId)!;
    pickables.push({
      box,
      target: { kind: 'district', id: district.id },
      label: district.displayName ?? district.name,
    });
  }

  const terrain = createTerrain(layout, { tier: opts.quality, sun, textures });
  scene.add(terrain.group);
  const clutterPlan = planClutter(layout, city.specs);
  const clutter = createClutterMeshes(clutterPlan, { sun, tier: opts.quality });
  scene.add(clutter.group);
  const traffic = createTraffic(layout, city.specs, {
    sun,
    cars: { high: 260, medium: 160, low: 60 }[opts.quality],
    crossings: clutterPlan.crossings,
    tier: opts.quality,
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
  const lift = createLift(liftPlan, collision, { sun, tier: opts.quality });
  scene.add(lift.group);

  // UR-01 waits on the sidewalk. A failed download only disables walking; the city keeps running.
  loadCharacter(opts.quality === 'low' ? 'mobile' : 'desktop', import.meta.env.BASE_URL)
    .then(model => {
      if (disposed) return model.dispose();
      model.root.position.set(CHARACTER_SPAWN.x, layout.islands[0].topY, CHARACTER_SPAWN.z);
      upgradeCharacterMaterials(model.root, { tier: opts.quality });
      for (const m of model.skinned) sun.setupMaterial(m.material as MeshStandardMaterial);
      scene.add(model.root);
      character = model;
      presence = createPresence(model);
      scene.add(presence.group);
      debug.character = () => measureBindPose(model);
      walk = createWalk({
        camera,
        canvas,
        world: collision,
        model,
        spawn: new Vector3(CHARACTER_SPAWN.x, layout.islands[0].topY, CHARACTER_SPAWN.z),
      });
      walk.onAction(a => a === 'exit' && setMode('orbit'));
      walkState = 'ready';
      walk.onAction(a => a === 'transit' && lift.press(walk!.controller.position));
      if (opts.sector === 'street' && !opts.shot) setMode('walk');
    })
    .catch(error => {
      walkState = 'failed';
      console.warn(String(error));
    });
  let character: Awaited<ReturnType<typeof loadCharacter>> | null = null;
  let presence: Presence | null = null;
  let walk: Walk | null = null;
  let disposed = false;
  let mode: WorldMode = 'orbit';
  let walkState: 'loading' | 'ready' | 'failed' = 'loading';
  const modeListeners: ((mode: WorldMode) => void)[] = [];
  function setMode(next: WorldMode): boolean {
    if (next === 'walk' && !walk) return false;
    if (next === mode) return true;
    mode = next;
    if (next === 'walk') {
      orbit.stopTour();
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
    for (const fn of modeListeners) fn(mode);
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
    // Override paints the sun red, day or night.
    const preset = override ? { ...PRESETS[time], sunColor: 0xff3c25 } : PRESETS[time];
    sky.setPreset(preset, time);
    sun.setPreset(preset);
    scene.environment = environment.update(sky.mesh);
    scene.environmentIntensity = preset.envIntensity;
    sunDirection(preset, sunDir);
    post.clouds.setPreset(preset, sunDir, time === 'night');
    post.setPreset(flags.has('nofog') ? { ...preset, fogDensity: 0 } : preset, sunDir);
    city.setNight(time === 'night', performance.now() < blackoutUntil ? 0 : preset.windowLitRatio);
    secrets.setNight(time === 'night');
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

  // Photo mode: the path tracer and the scene baker load on first use, in their own chunk.
  let photoModule: typeof import('../phototrace/lazy') | null = null;
  let photoActive = false;
  const photoErrors: ((message: string) => void)[] = [];
  const saves: { resolve(b: Blob): void; reject(e: Error): void }[] = [];
  const photo = createPhotoSession({
    renderer,
    camera,
    setInput: texture => post.setInput(texture),
    setSamples: samples => post.setPhotoSamples(samples),
    loadTracer: async () => {
      photoModule ??= await import('../phototrace/lazy');
      return photoModule.createTracer(renderer);
    },
    buildScene: () => {
      const preset = PRESETS[currentTime];
      const sources = [city.group, terrain.group, clutter.group, traffic.group, lift.group];
      if (character) sources.push(character.root);
      return photoModule!.buildPhotoScene(sources, {
        night: currentTime === 'night',
        litRatio: preset.windowLitRatio,
        layout,
        camera,
        lampLights: 24,
        lampHeads,
        sun: { direction: sunDir.clone(), color: new Color(preset.sunColor), intensity: preset.sunIntensity },
        textures: { rock: textures.rock.map },
      });
    },
    environment: () => photoModule!.skyToEquirect(renderer, sky.mesh),
    canWorker: () => typeof Worker !== 'undefined',
    onActive: active => {
      photoActive = active;
      // A photograph of the city, without its labels.
      signs.labels.visible = !active;
      // Walking freezes while tracing; the orbit camera still moves (and restarts accumulation).
      walk?.input.clear();
      if (active) orbit.stopTour();
      // The raster frame only supplies depth while tracing: no need to redraw the shadow cascades.
      renderer.shadowMap.autoUpdate = !active;
      renderer.shadowMap.needsUpdate = !active;
    },
    onError: message => photoErrors.forEach(fn => fn(message)),
  });

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

  debug.photo = { enter: () => photo.enter(), status: () => photo.status(), triangles: () => photo.triangles };

  const heroBox = new Box3();
  const heroAt = new Vector3();
  pickables.push({
    box: () => heroBox.setFromCenterAndSize(traffic.heroPod(heroAt), new Vector3(14, 7, 14)),
    target: { kind: 'vehicle' },
    label: 'UR-07 · Meridian air taxi',
  });
  const hoverListeners: ((label: string | null) => void)[] = [];
  const pickListeners: ((target: PickTarget) => void)[] = [];
  const raycaster = new Raycaster();
  const ndc = new Vector2();
  let pressedAt: { x: number; y: number } | null = null;
  let hovered: string | null = null;
  const canPick = () => mode === 'orbit' && !photoActive;
  const pickAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return pickNearest(raycaster.ray, [...pickables, ...secrets.pickables()]);
  };
  const setHover = (label: string | null) => {
    if (label === hovered) return;
    hovered = label;
    canvas.style.cursor = label ? 'pointer' : '';
    for (const fn of hoverListeners) fn(label);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!canPick() || e.buttons) return;
    setHover(pickAt(e)?.label ?? null);
  };
  // Fixed v1 quirk: leaving the canvas clears the label.
  const onPointerLeave = () => setHover(null);
  const onPointerDown = (e: PointerEvent) => (pressedAt = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: PointerEvent) => {
    const from = pressedAt;
    pressedAt = null;
    if (!from || !canPick() || !isClick(from, { x: e.clientX, y: e.clientY })) return;
    const hit = pickAt(e);
    if (hit) for (const fn of pickListeners) fn(hit.target);
  };
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);

  function frame(timestamp?: number) {
    timer.update(timestamp);
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1);
    const street = photoActive || paused ? 0 : dt;
    if (!paused) sceneTime += dt;
    // The lift carries UR-01 even outside walk mode, so leaving mid-ride never strands them in the shaft.
    lift.update(street, walk?.controller);
    if (photoActive) {
      if (!walk?.active) orbit.update(dt);
    } else if (walk?.active) {
      if (!paused) walk.update(dt);
    } else {
      orbit.update(dt);
      walk?.idle(dt, flags.has('walkcycle') ? 1.6 : 0);
    }
    sky.update(sceneTime);
    city.update(paused ? 0 : dt);
    post.clouds.update(sceneTime);
    terrain.update(sceneTime);
    // The traced scene is a still: traffic and signals pause with it.
    streetClock += street;
    traffic.update(street, streetClock, camera.position);
    terrain.street.update(camera.position);
    clutter.update(streetClock);
    updateStreetLights(currentTime === 'night');
    presence?.update(camera, currentTime === 'night');
    camera.updateMatrixWorld();
    signs.update(camera);
    secrets.update(sceneTime);
    sun.update();
    photo.frame();
    renderer.info.reset();
    if (flags.has('nopost')) {
      renderer.toneMapping = AgXToneMapping;
      renderer.toneMappingExposure = PRESETS[currentTime].exposure;
      renderer.render(scene, camera);
    } else post.render(dt);
    // A WebGL canvas can only be read in the frame it was drawn.
    for (const s of saves.splice(0))
      canvas.toBlob(
        blob => (blob ? s.resolve(blob) : s.reject(new Error('The frame could not be saved.'))),
        'image/png',
      );
    debug.frame += 1;
    if (debug.frame >= 2) debug.ready = true;
    // Frame time is the real interval between frames, so GPU-bound slowness is included.
    const nextDpr = pixelated ? null : adaptive?.update(rawDt * 1000, dt);
    if (nextDpr) {
      renderer.setPixelRatio(nextDpr);
      resize(size.width, size.height);
    }
  }

  // Rendering stops while the tab is hidden and resumes when it is shown again.
  const syncLoop = () => renderer.setAnimationLoop(document.hidden ? null : frame);
  document.addEventListener('visibilitychange', syncLoop);
  syncLoop();

  let paused = false;
  let pixelated = false;
  // The city's own clock: it stands still while paused.
  let sceneTime = 0;
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
    onModeChange: fn => void modeListeners.push(fn),
    walkState: () => walkState,
    setSector(sector) {
      signs.setFocus(null);
      if (sector === 'street') return setMode('walk');
      if (mode === 'walk') setMode('orbit');
      const pose = sector === 'underworld' ? UNDERWORLD_POSE : OVERVIEW_POSE;
      orbit.flyTo(pose.position, pose.target);
      return true;
    },
    focusDistrict(id) {
      const frame = landmarks.get(id);
      if (!frame) return;
      if (mode === 'walk') setMode('orbit');
      signs.setFocus(id);
      const pose = focusPose(frame);
      orbit.flyTo(pose.position, pose.target);
    },
    setPaused(p) {
      paused = p;
      orbit.setPaused(p);
      if (p) walk?.input.clear();
    },
    setTour(on) {
      if (on) orbit.startTour();
      else orbit.stopTour();
    },
    onTourChange: fn => orbit.onTourChange(fn),
    onHover: fn => void hoverListeners.push(fn),
    onPick: fn => void pickListeners.push(fn),
    followVehicle: () => orbit.follow(() => traffic.heroPod(heroAt)),
    setOverride(on) {
      override = on;
      city.facade.uniforms.uWindowTint.value.setRGB(1, on ? 0.33 : 1, on ? 0.23 : 1);
      secrets.setOverride(on);
      setTime(currentTime);
    },
    blackout(ms) {
      blackoutUntil = performance.now() + ms;
      signs.setVisible(false);
      setTime(currentTime);
      window.clearTimeout(blackoutTimer);
      blackoutTimer = window.setTimeout(() => {
        blackoutUntil = 0;
        signs.setVisible(true);
        setTime(currentTime);
      }, ms);
    },
    setCompleted: on => secrets.setCompleted(on),
    setCatFound: found => secrets.setCatFound(found),
    setFly: on => orbit.setFly(on),
    setFlyInput: input => orbit.setFlyInput(input),
    setPixelated(on) {
      pixelated = on;
      renderer.setPixelRatio(on ? 0.62 : Math.min(window.devicePixelRatio || 1, settings.maxDpr));
      resize(size.width, size.height);
    },
    liftStatus: () => (walk?.active ? lift.status(walk.controller.position) : null),
    photo: {
      enter: () => photo.enter(),
      exit: () => photo.exit(),
      status: () => photo.status(),
      onError: fn => void photoErrors.push(fn),
      focusAt: (x, y) => photo.setFocus(focusDistance(collision, camera, x, y)),
      setAperture: f => photo.setAperture(f),
      save: () => new Promise<Blob>((resolve, reject) => saves.push({ resolve, reject })),
    },
    dispose() {
      disposed = true;
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      signs.dispose();
      secrets.dispose();
      window.clearTimeout(blackoutTimer);
      walk?.dispose();
      character?.dispose();
      presence?.dispose();
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
      photo.exit();
      clutter.dispose();
      lift.dispose();
      reflection?.dispose();
      environment.dispose();
      renderer.dispose();
    },
  };
}
