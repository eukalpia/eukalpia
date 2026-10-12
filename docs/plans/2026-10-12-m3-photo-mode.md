# Этап 3: фото-режим с трассировкой — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** кнопка PHOTO превращает текущий кадр в почти фотографический: тот же город, трассировка путей
с прогрессивным накоплением, шумоподавление, глубина резкости с фокусом по клику и сохранение PNG.

**Architecture:** при первом входе лениво грузится чанк `phototrace/` (динамический `import()`), который
собирает из живого мира отдельную статическую сцену: инстансы разворачиваются в объединённую геометрию,
нестандартные шейдеры (фасады, земля, скала) заменяются `MeshStandardMaterial` с запечёнными текстурами
тех же параметров. `WebGLPathTracer` (three-gpu-pathtracer, основной экспорт, WebGL2) строит BVH в воркере
и накапливает сэмплы. Его HDR-выход идёт в наш пост-конвейер вместо RenderPass: туман, облака, bloom и AgX
остаются теми же, поэтому вид в двух режимах совпадает. Поверх работает edge-aware фильтр по нормалям
и глубине растрового G-буфера, ослабевающий с ростом числа сэмплов.

**Tech Stack:** three r186, three-gpu-pathtracer 0.0.27 (`WebGLPathTracer`, `PhysicalCamera`),
three-mesh-bvh 0.9.16 (`ParallelMeshBVHWorker`), postprocessing 6.39, React 19, vitest, Playwright.

**Spec:** `docs/specs/2026-10-12-eukalpia-v2-design.md` (раздел 8, раздел 12 п. 3).

## Global Constraints

- Только `WebGLPathTracer` из основного экспорта `three-gpu-pathtracer` (WebGL2). WebGPU не цель (раздел 1).
- Вне фото-режима всё бесплатно: ни байта `phototrace/` и `three-gpu-pathtracer` в основном чанке,
  сцена и BVH строятся только при первом включении, BVH — в Web Worker.
- Прогрессивное накопление: превью в низком разрешении (`dynamicLowRes`, `lowResScale` 0,25), затем полное.
- Шумоподавление edge-aware по нормалям и глубине (и альбедо, где оно есть в G-буфере).
- Глубина резкости с фокусом по клику; диафрагма f/1.4 … f/16, по умолчанию f/8 (почти всё резко).
- Отказы с понятными сообщениями и возвратом в обычный режим без падения:
  нет `EXT_color_buffer_float`; не создаётся воркер; потерян контекст WebGL; сборка сцены бросила ошибку.
- Кнопка «Save frame» сохраняет PNG `eukalpia-<ISO-время>.png` в разрешении буфера.
- Те же текстуры, что в растре (бетон, сталь, кирпич, скала, лист), без параллакса интерьеров.
- Приёмка: кадр после 256 сэмплов в headless (SwiftShader, допускается 640×360) без ошибок консоли;
  сообщение об отказе при отключённом `EXT_color_buffer_float`.
- Живой сайт не трогаем (`site/`, `public/`, `.github/`). Текст интерфейса — по-английски, как в v1.

## Review Focus

1. Камеру двигают во время накопления (орбита, колесо, ресайз окна) → накопление сбрасывается, кадр не «размазан». Тест в Task 4.
2. Выход из фото-режима посреди сборки сцены (Esc, повторный клик) → сборка отменяется, обычный рендер продолжается, память освобождена. Тест в Task 4.
3. Ночь в фото-режиме: окна и фонари светятся, а не чернеют (эмиссия без MIS даёт светлячков, но не тьму). Тест в Task 2.
4. Клик для фокуса в небо или в пустоту под островом → фокус на бесконечность, без NaN. Тест в Task 5.
5. Вход в фото-режим во время прогулки → персонаж в кадре в текущей позе, ввод клавиш заморожен до выхода. Тест в Task 4.

---

### Task 1: Запечённые фасады, земля и скала

**Files:**
- Create: `app/src/phototrace/bake.ts`
- Test: `app/tests/bake.test.ts`

**Interfaces:**
- Consumes: стили и `aBuilding` / `aBays` / метрические UV стен из `world/buildings/geometry.ts`; `fLitAtLevel`,
  `LIT_ROOM_MEAN` и пороги окон из `world/buildings/facadeMaterial.ts`; маска земли `rasterizeGround`.
- Produces:
  - `FACADE_CELLS = 16`;
  - `bakeFacade(style: StyleId, opts: { night: boolean; litRatio: number; seed: number; size?: number }): BakedMaps`
    где `BakedMaps = { map: DataTexture; roughnessMap: DataTexture; metalnessMap: DataTexture; emissiveMap: DataTexture | null }` —
    атлас 16×16 ячеек «пролёт × этаж» с той же раскладкой проёма, рамы и откоса, что `fOpening` в шейдере;
    ночью ячейка горит, если хеш ячейки < `litRatio`;
  - `facadeUVs(geometry: BufferGeometry): Float32Array` — UV стен в пространстве атласа:
    `u = (bays + offB) / 16`, `v = (floors + offF) / 16`, где `bays = uMetric / bayWidth`, `floors = vMetric / floorHeight`,
    сдвиги `offB, offF ∈ [0,16)` из `seed` здания;
  - `bakeGround(layout, islandId, size): BakedMaps` — альбедо и шероховатость из маски (асфальт, плитка, трава, разметка),
    те же цвета, что `groundMaterial.ts`;
  - `rockUVs(geometry): Float32Array` — кубическая проекция по доминирующей оси нормали, масштаб как у трипланара.

- [ ] **Step 1: Write failing tests**

```ts
test('a wall vertex lands in the right atlas cell', () => {
  // стена: bayWidth 3, floorHeight 4, seed с offB=0, offF=0; вершина uMetric 9, vMetric 8 → uv (3/16, 2/16)
});
test('the atlas repeats seamlessly every 16 bays and floors', () => { /* uv при bays=16 ≡ uv при bays=0 по модулю 1 */ });
test('at night the lit share of cells matches the ratio', () => { /* litRatio 0.28 → доля горящих ячеек 0.28 ± 0.06 */ });
test('by day nothing glows', () => { /* bakeFacade(..., night: false).emissiveMap === null */ });
test('glass panes are smooth and metallic frames rough', () => { /* центр проёма: roughness < 0.15; середина простенка: > 0.6 */ });
test('baked ground matches the mask', () => { /* пиксель асфальта темнее плитки; трава зелёная (g > r, g > b) */ });
```
- [ ] **Step 2:** Run `npx vitest run tests/bake.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement in `app/src/phototrace/bake.ts` (DataTexture, не canvas — тесты идут в node).
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** `git commit -m "phototrace: baked facade, ground and rock maps"`

---

### Task 2: Статическая сцена для трассировки

**Files:**
- Create: `app/src/phototrace/photoScene.ts`
- Test: `app/tests/photoScene.test.ts`

**Interfaces:**
- Consumes: Task 1; `World` части: `city.group`, `terrain.group`, `clutter.group`, `traffic.group`, `lift.group`, персонаж.
- Produces:
  - `buildPhotoScene(sources: Object3D[], opts: { night: boolean; litRatio: number; layout: CityLayout; camera: Camera; lampLights: number }): PhotoScene`
    где `PhotoScene = { scene: Scene; triangles: number; dispose(): void }`;
  - правила: `InstancedMesh` → одна объединённая геометрия (матрица каждого инстанса, цвет инстанса → вершинный цвет);
    `SkinnedMesh` → текущая поза; материал с `onBeforeCompile` заменяется копией `MeshStandardMaterial` с картами Task 1;
    невидимые объекты и `MeshBasicMaterial` линзы светофоров → эмиссивный `MeshStandardMaterial`;
    ночью `lampLights` ближайших к камере фонарей → `PointLight` (по умолчанию 24), луна → `DirectionalLight`;
    днём солнце → `DirectionalLight` того же направления и цвета.

- [ ] **Step 1: Write failing tests**

```ts
test('instances become one merged mesh with every instance placed', () => { /* InstancedMesh из 3 боксов → 1 Mesh, 36 треугольников, bbox покрывает все три */ });
test('custom shaders are replaced by standard materials', () => { /* ни у одного материала нет onBeforeCompile ≠ default; все isMeshStandardMaterial */ });
test('the night scene has light: glowing windows and lamp point lights', () => { /* night: true → есть материал с emissiveMap; число PointLight = lampLights */ });
test('the real city fits the photo budget', () => { /* buildPhotoScene(реальный город High) → triangles ≤ 3_000_000 */ });
test('a skinned character is baked in its pose', () => { /* SkinnedMesh с повёрнутой костью → вершины совпадают с позой ± 1e-4 */ });
```
- [ ] **Step 2:** RED. **Step 3:** Implement. **Step 4:** GREEN.
- [ ] **Step 5: Commit** `git commit -m "phototrace: static scene builder"`

---

### Task 3: Небо, облака и туман для трассировки

**Files:**
- Create: `app/src/phototrace/environment.ts`, `app/src/phototrace/photoInputPass.ts`
- Modify: `app/src/engine/post.ts` (режим `photo`: вход из текстуры трассировки, N8AO выключен)
- Test: `app/tests/photoEnvironment.test.ts`

**Interfaces:**
- Consumes: `sky.ts` (Sky и ночное небо), `post.ts` цепочка.
- Produces:
  - `skyToEquirect(renderer, skyScene, size = 1024): DataTexture` — HDR equirect (float), используется как `scene.environment`
    и `scene.background` сцены трассировки;
  - `class PhotoInputPass extends Pass` — рендерит растровую сцену только в глубину и нормали (для тумана, облаков и фильтра)
    и копирует в выходной буфер HDR-текстуру трассировки;
  - `post.setInput(texture: Texture | null)` — `null` возвращает обычный RenderPass.

- [ ] **Step 1: Write failing tests**

```ts
test('equirect directions match the sky', () => { /* пиксель с направлением на солнце ярче среднего неба; зенит ночью темнее горизонта днём */ });
test('photo input keeps depth for fog and clouds', () => { /* PhotoInputPass.needsDepthTexture === true; фрагмент шейдера копирования читает tPath */ });
test('photo mode turns ambient occlusion off', () => { /* post.setInput(tex) → n8ao.enabled === false; setInput(null) → true */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN. **Step 5: Commit** `git commit -m "phototrace: equirect sky and photo input pass"`

---

### Task 4: Сессия фото-режима и отказы

**Files:**
- Create: `app/src/phototrace/support.ts`, `app/src/phototrace/session.ts`
- Modify: `app/src/engine/world.ts` (`photo` API), `app/vite.config.ts` (воркер BVH)
- Test: `app/tests/photoSession.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `checkPhotoSupport(gl: WebGL2RenderingContext | null, canWorker: boolean): { ok: true } | { ok: false; message: string }` с текстами:
    - `Photo mode needs floating-point render targets (EXT_color_buffer_float), which this GPU does not offer.`
    - `Photo mode could not start its scene worker. Try reloading the page.`
    - `Photo mode lost the graphics context. The city is back in normal mode.`
    - `Photo mode could not build the scene: <error>.`
  - `World.photo: { enter(): Promise<{ ok: true } | { ok: false; message: string }>; exit(): void; status(): PhotoStatus | null; focusAt(x: number, y: number): void; setAperture(fStop: number): void; save(): Promise<Blob> }`,
    `PhotoStatus = { phase: 'building' | 'tracing'; samples: number; target: number }`, `target = 256`;
  - камера `PhysicalCamera` повторяет позу и FOV текущей камеры; любое изменение позы, FOV или размера → `pathTracer.reset()`;
  - ввод прогулки заморожен (`walk.input.clear()` и игнор), орбита работает и сбрасывает накопление.

- [ ] **Step 1: Write failing tests**

```ts
test('no float buffers → a clear refusal', () => { /* fake gl без расширения → ok false, текст как выше */ });
test('no worker → a clear refusal', () => { /* canWorker false → текст про worker */ });
test('moving the camera restarts accumulation', () => { /* фейковый трассировщик: samples 40 → сдвиг камеры → reset вызван, samples 0 */ });
test('leaving during the build cancels it', () => { /* enter() → exit() до готовности → сцена disposed, post.setInput(null), status() null */ });
test('walking input is frozen while tracing', () => { /* walk активен, enter → keydown W → controller не двигается */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN.
- [ ] **Step 5: Commit** `git commit -m "phototrace: photo session, support checks and world API"`

---

### Task 5: Шумоподавление, фокус и сохранение кадра

**Files:**
- Create: `app/src/phototrace/denoise.ts`, `app/src/phototrace/focus.ts`
- Modify: `app/src/phototrace/session.ts`
- Test: `app/tests/denoise.test.ts`, `app/tests/focus.test.ts`

**Interfaces:**
- Produces:
  - `denoiseWeight(dn: number, dz: number, dl: number, samples: number): number` — TS-зеркало веса GLSL-фильтра
    (à-trous, 3 итерации 1-2-4): вес падает с углом нормалей, разницей глубины и яркости; `sigmaL ∝ 1/sqrt(samples)`;
  - `class DenoisePass extends Pass` с тем же весом в GLSL (маркер `/*denoise:weight*/`);
  - `focusDistance(world: CollisionWorld, camera: Camera, ndcX: number, ndcY: number): number` — луч из камеры,
    промах → `Infinity` (камера ставит фокус 10 000 м);
  - `saveName(date: Date): string` → `eukalpia-2026-10-12T12-30-05.png`.

- [ ] **Step 1: Write failing tests**

```ts
test('edges keep their sharpness', () => { /* denoiseWeight(dn = 0.9, 0, 0, 16) < 0.05 */ });
test('flat noisy regions are smoothed', () => { /* denoiseWeight(0, 0, 0.1, 16) > 0.5 */ });
test('the filter fades as samples converge', () => { /* weight(…, dl 0.1, 256) < weight(…, dl 0.1, 16) */ });
test('clicking the sky focuses at infinity', () => { /* луч вверх → Infinity, без NaN */ });
test('clicking a wall focuses on it', () => { /* камера в 20 м от стены → 20 ± 0.05 */ });
test('saved frames get a sortable name', () => { /* saveName(new Date('2026-10-12T12:30:05Z')) === 'eukalpia-2026-10-12T12-30-05.png' */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN. **Step 5: Commit** `git commit -m "phototrace: denoise, click focus and save frame"`

---

### Task 6: Кнопка PHOTO и панель

**Files:**
- Create: `app/src/app/PhotoPanel.tsx`
- Modify: `app/src/app/App.tsx`, `app/src/styles.css`
- Test: `app/tests/photoPanel.test.tsx`

**Interfaces:**
- Consumes: `World.photo` (Task 4).
- Produces: кнопка `PHOTO` (aria-label `Open photo mode`); в режиме — строка `TRACING · 37 / 256` (или `BUILDING SCENE…`),
  ползунок диафрагмы `f/1.4…f/16`, подсказка `Click to focus`, кнопки `Save frame` и `Exit` (Esc тоже выходит);
  отказ показывается строкой `role="alert"` с текстом из Task 4 на 6 с, режим возвращается в обычный.

- [ ] **Step 1: Write failing tests** (jsdom, фейковый `World.photo`)

```ts
test('entering shows progress and Exit returns', () => { ... });
test('a refusal is announced and photo mode closes', () => { /* enter → { ok: false, message } → role=alert с текстом, кнопка PHOTO снова видна */ });
test('Save frame downloads a png', () => { /* save → Blob; создан <a download="eukalpia-…png"> */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN. **Step 5: Commit** `git commit -m "ui: photo mode button and panel"`

---

### Task 7: Приёмка этапа 3

- [ ] **Step 1:** `scripts/shots.mjs` получает `--photo=N`: входит в фото-режим, ждёт `samples ≥ N` (таймаут 30 мин),
  снимает кадр; `--no-float` подменяет `getExtension('EXT_color_buffer_float')` на `null` и проверяет `role=alert`.
- [ ] **Step 2:** `node scripts/shots.mjs --size=640x360 --photo=256 photo-day photo-street photo-night` и
  `--no-float photo-day` → выход 0, без ошибок консоли.
- [ ] **Step 3:** `npx vitest run`, `npm run build` зелёные; основной чанк не содержит `three-gpu-pathtracer`
  (`grep -L WebGLPathTracer dist/assets/index-*.js`).
- [ ] **Step 4:** Записать `docs/plans/2026-10-12-m3-acceptance.md` (время до 256 сэмплов, треугольники сцены, снимки,
  найденное и перенесённое). Commit, push, отправить владельцу кадры трассировки рядом с растровыми.
