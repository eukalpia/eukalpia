# Этап 1: город с орбиты (день и ночь). План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новый движок и процедурный город в реальном масштабе, гиперреалистичный при виде с орбиты днём и ночью.

**Architecture:** Vite + TS-приложение в `app/`. Чистые генераторы (раскладка, здания, острова, маски
земли) работают без WebGL и покрыты vitest. Рендер собран из небольших модулей (небо, солнце, окружение,
облака, постобработка), которые собирает `engine/world.ts`. Визуальную приёмку делает скрипт Playwright:
он снимает фиксированные ракурсы и проверяет бюджеты через `window.__eukalpia`.

**Tech Stack:** three 0.186.1, postprocessing 6.39.5, n8ao 2.0.1, react/react-dom 19.3.0, vite 8.3.4,
@vitejs/plugin-react 6.1.2, typescript 7.0.2, vitest 5.0.3, playwright-core 1.56.1 (совпадает с Chromium
в `/opt/pw-browsers/chromium`), @pmndrs/assets 1.7.0 (CC0 HDRI).

**Spec:** `docs/specs/2026-10-12-eukalpia-v2-design.md` (разделы 3–6, 12 «Этап 1»).

## Global Constraints

- 1 единица = 1 метр. Главный остров диаметром 520 м (радиус 260), 4 спутника на расстоянии 420 м от центра.
  Monolith высотой 320 м.
- Улицы: кварталы 60–90 м, ширина улиц 14–22 м.
- База сайта `/eukalpia/` (`vite.config.ts` → `base: '/eukalpia/'`).
- Рендер только WebGL2. Тонмаппинг AgX в постобработке, выход sRGB.
- Бюджеты кадра: High ≤ 900 draw calls и ≤ 6 млн треугольников; Medium ≤ 600 / 3 млн; Low ≤ 300 / 1,2 млн.
- Адаптивное разрешение: при кадре дольше 22 мс DPR снижается ступенями до 0,6.
- Раскладка детерминирована по seed (по умолчанию `20260905`).
- Живой сайт не трогаем: папки `site/`, `public/` и `.github/` на этом этапе не меняются.
- Ассеты v1 копируются в `app/public/`, а не переносятся (`site/` должен остаться целым до этапа 5).
- Нельзя использовать внешние CDN в рантайме: все ассеты локальные.
- Вне этапа 1 (переносятся на этап 2): LOD зданий, геометрия фонарей, деревья, машины, летающий транспорт, неон.
  На этапе 1 фонари — только светящиеся точки для ночного вида с орбиты.

## Review Focus

1. Нет WebGL2 или контекст не создаётся → показывается открытка (`city-cinematic.webp`) с подписью, а не пустой экран. Тест в Task 1.
2. Ошибка компиляции шейдера на любом уровне качества → скрипт снимков падает (ловит `THREE.WebGLProgram` и `console.error`). Тест в Task 1, прогон `--quality=low` в Task 9.
3. Изменение размера окна → композер, CSM и камера обновляются, картинка не растягивается. Тест в Task 9.
4. `prefers-reduced-motion: reduce` → кинематографичный тур не стартует. Тест в Task 3.
5. Вкладка скрыта → цикл рендера останавливается (`visibilitychange`). Тест в Task 1.

---

## Файлы

```
app/
  package.json, tsconfig.json, vite.config.ts, index.html
  public/materials/…          копии текстур v1 (concrete, rock, steel) + sky-light.hdr
  public/models/factory-kit/… копия factory-kit v1
  public/city-cinematic.webp, public/favicon.svg
  scripts/shots.mjs           визуальный прогон (Playwright)
  src/main.tsx                вход: выбор уровня, создание мира, fallback
  src/app/App.tsx             минимальный UI этапа 1 (день/ночь), Postcard
  src/engine/world.ts         сборка сцены и цикл рендера
  src/engine/debug.ts         window.__eukalpia, пресеты снимков
  src/engine/quality.ts       уровни, бюджеты, AdaptiveResolution
  src/engine/camera/orbit.ts  орбита и тур
  src/engine/lighting/timeOfDay.ts, sky.ts, sun.ts, environment.ts
  src/engine/atmosphere/AtmosphereEffect.ts, clouds.ts, noise3d.ts
  src/engine/post.ts          композер и эффекты
  src/content/districts.ts, signals.ts
  src/world/rng.ts, layout.ts
  src/world/buildings/styles.ts, massing.ts, geometry.ts, facadeMaterial.ts, landmarks.ts
  src/world/islands/island.ts, waterfall.ts, bridge.ts, rockMaterial.ts
  src/world/ground/groundMask.ts, groundMaterial.ts
  src/world/city.ts           сборка всех мешей мира из layout
  tests/*.test.ts
```

---

### Task 1: Каркас приложения, цикл рендера, fallback, скрипт снимков

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/vite.config.ts`, `app/index.html`, `app/src/main.tsx`,
  `app/src/app/App.tsx`, `app/src/engine/world.ts`, `app/src/engine/debug.ts`, `app/scripts/shots.mjs`
- Create: `app/public/` (копии из `site/`: `materials/*`, `models/factory-kit/**`, `city-cinematic.webp`, `favicon.svg`)
- Test: `app/tests/debug.test.ts`

**Interfaces:**
- Produces:
  - `createWorld(canvas: HTMLCanvasElement, opts: WorldOptions): Promise<World>`, где
    `WorldOptions = { quality: QualityTier; time: TimeOfDay; shot?: ShotName; reducedMotion: boolean }`,
    `World = { setTime(t: TimeOfDay): void; resize(w: number, h: number): void; dispose(): void; renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera }`.
    На этом шаге `QualityTier = 'high'|'medium'|'low'` и `TimeOfDay = 'day'|'night'` объявлены в `world.ts`.
    Task 2 и Task 4 переносят их в `quality.ts` и `timeOfDay.ts` и реэкспортируют.
  - `parseShotParams(search: string): { shot?: ShotName; time?: TimeOfDay; quality?: QualityTier }` в `debug.ts`,
    `ShotName = 'orbit-day'|'orbit-night'|'underside'|'skyline'`.
  - `window.__eukalpia = { ready: boolean; frame: number; errors: string[]; stats(): DebugStats }`,
    `DebugStats = { drawCalls: number; triangles: number; dpr: number; tier: QualityTier; budget: { drawCalls: number; triangles: number }; withinBudget: boolean }`.
  - Скрипт `npm run shots -- [--quality=high|medium|low] <shot...>` пишет `app/test-results/shots/<shot>.png`
    и `stats.json`. Код выхода 1 при `console.error`, ошибке страницы, сообщении `THREE.WebGLProgram` или `withinBudget=false`.

- [ ] **Step 1: Write the failing test** `app/tests/debug.test.ts`

```ts
import { parseShotParams } from '../src/engine/debug';
test('parses shot, time and quality', () => {
  expect(parseShotParams('?shot=orbit-night&time=night&quality=low'))
    .toEqual({ shot: 'orbit-night', time: 'night', quality: 'low' });
});
test('ignores unknown values', () => {
  expect(parseShotParams('?shot=nope&time=noon&quality=ultra')).toEqual({});
});
```

- [ ] **Step 2: Run** `cd app && npx vitest run tests/debug.test.ts`. Expected: FAIL (модуля нет).
- [ ] **Step 3: Scaffold.** `npm init` с точными версиями из Tech Stack, скрипты `dev`, `build` (`tsc --noEmit && vite build`),
  `preview`, `test` (`vitest run`), `shots` (`vite build && node scripts/shots.mjs`). `vite.config.ts`: `base: '/eukalpia/'`,
  `build.sourcemap: false`, `test.environment: 'node'`. Скопировать ассеты v1 в `app/public/`.
- [ ] **Step 4: Implement** `parseShotParams`, `createWorld` (WebGLRenderer с `antialias: false`,
  `powerPreference: 'high-performance'`; пустая сцена; `PerspectiveCamera(40, aspect, 1, 12000)`), цикл `setAnimationLoop`,
  который останавливается на `document.hidden` и возобновляется на `visibilitychange`. Добавить `debug.ts` с `__eukalpia`
  (`ready` выставляется после 2 отрисованных кадров). `main.tsx`: если `canvas.getContext('webgl2')` вернул null или
  `createWorld` бросил исключение, показать `<Postcard/>`: `<img src="city-cinematic.webp" alt="A captured view of the floating 3D city">`
  и текст `POSTCARD MODE · Open Projects to explore every district.` (дословно из v1).
- [ ] **Step 5: Implement `scripts/shots.mjs`.** Поднять `vite preview --port 4173`. Chromium по пути `process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium'`
  с флагами `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`, вьюпорт 1280×720.
  Для каждого снимка открыть `/eukalpia/?shot=<name>&time=<day|night по имени>&quality=<q>`, ждать `__eukalpia.ready && frame >= 12`
  (таймаут 240 с), сделать снимок, записать stats. Флаг `--no-webgl` запускает Chromium с `--disable-webgl` и проверяет, что `img[alt^="A captured view"]` видна.
- [ ] **Step 6: Run** `npx vitest run` → PASS. `npm run shots -- orbit-day` → PNG создан, выход 0.
  `node scripts/shots.mjs --no-webgl` → выход 0. Вручную: `document.hidden` в devtools-эмуляции останавливает `frame`
  (проверка встроена в shots.mjs: `page.evaluate` диспатчит `visibilitychange` с подменой `document.hidden=true`, и `frame` не растёт 1 с).
- [ ] **Step 7: Commit** `git add app && git commit -m "app: scaffold v2 engine shell, postcard fallback and visual shot harness"`

---

### Task 2: Уровни качества, бюджеты, адаптивное разрешение

**Files:**
- Create: `app/src/engine/quality.ts`
- Test: `app/tests/quality.test.ts`

**Interfaces:**
- Produces:
  - `type QualityTier = 'high'|'medium'|'low'`
  - `BUDGETS: Record<QualityTier, { drawCalls: number; triangles: number }>` = high 900 / 6_000_000, medium 600 / 3_000_000, low 300 / 1_200_000.
  - `detectTier(i: { mobile: boolean; cores: number; renderer: string; screenArea: number }): QualityTier`:
    `mobile` → low; `renderer` совпадает с `/intel|uhd|iris|mali|adreno|powervr/i` или `cores < 6` → medium; иначе high.
    URL-параметр `quality` имеет приоритет (обрабатывает `main.tsx`).
  - `TIER_SETTINGS: Record<QualityTier, { csmCascades: number; shadowMapSize: number; ao: 'full'|'half'|'off'; cloudSteps: number; interiorFurniture: boolean; maxDpr: number }>`
    = high {4, 2048, 'full', 48, true, 2}, medium {3, 2048, 'half', 24, true, 1.5}, low {2, 1024, 'off', 0, false, 1.5}
    (`cloudSteps: 0` означает 2D-слои облаков).
  - `class AdaptiveResolution { constructor(maxDpr: number); update(frameMs: number, dtSec: number): number | null }`.
    Хранит EMA кадра (α = 0.1). Если EMA > 22 мс непрерывно ≥ 1 с, DPR −0.15 (не ниже 0.6). Если EMA < 14 мс непрерывно ≥ 3 с,
    DPR +0.15 (не выше `maxDpr`). Возвращает новый DPR при изменении, иначе null. После смены таймеры сбрасываются.

- [ ] **Step 1: Write failing tests**

```ts
test('mobile is low', () => expect(detectTier({ mobile: true, cores: 8, renderer: 'Apple GPU', screenArea: 3e5 })).toBe('low'));
test('integrated GPU is medium', () => expect(detectTier({ mobile: false, cores: 8, renderer: 'ANGLE (Intel, Iris Xe)', screenArea: 2e6 })).toBe('medium'));
test('discrete GPU is high', () => expect(detectTier({ mobile: false, cores: 12, renderer: 'ANGLE (NVIDIA, RTX 3060)', screenArea: 2e6 })).toBe('high'));
test('slow frames lower DPR in 0.15 steps down to 0.6', () => {
  const a = new AdaptiveResolution(2); let dpr = 2;
  for (let i = 0; i < 2000; i++) { const r = a.update(40, 1 / 25); if (r !== null) dpr = r; }
  expect(dpr).toBeCloseTo(0.6);
});
test('fast frames raise DPR back to max', () => {
  const a = new AdaptiveResolution(1.5); let dpr = 1.5;
  for (let i = 0; i < 400; i++) { const r = a.update(40, 1 / 25); if (r !== null) dpr = r; }
  for (let i = 0; i < 4000; i++) { const r = a.update(8, 1 / 120); if (r !== null) dpr = r; }
  expect(dpr).toBeCloseTo(1.5);
});
test('budgets match spec', () => expect(BUDGETS.low).toEqual({ drawCalls: 300, triangles: 1_200_000 }));
```

- [ ] **Step 2: Run** `npx vitest run tests/quality.test.ts` → FAIL.
- [ ] **Step 3: Implement** `quality.ts`. Подключить в `world.ts`: DPR из `AdaptiveResolution`, `stats().budget` из `BUDGETS`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "engine: quality tiers, frame budgets and adaptive resolution"`

---

### Task 3: Орбитальная камера, тур, пресеты снимков

**Files:**
- Create: `app/src/engine/camera/orbit.ts`
- Modify: `app/src/engine/world.ts` (подключить орбиту), `app/src/engine/debug.ts` (пресеты)
- Test: `app/tests/orbit.test.ts`

**Interfaces:**
- Produces:
  - `ORBIT_LIMITS = { minDistance: 60, maxDistance: 2200, maxPolarAngle: 2.0, target: [0, 60, 0] }`
  - `SHOT_PRESETS: Record<ShotName, { position: [number, number, number]; target: [number, number, number] }>`:
    `orbit-day` и `orbit-night`: позиция (720, 420, 780), цель (0, 40, 0); `underside`: (520, −380, 620), цель (0, −120, 0);
    `skyline`: (260, 70, 340), цель (0, 120, 0).
  - `tourPose(t: number): { azimuth: number; polar: number; distance: number }`: азимут `0.6 + 0.02·t`,
    полярный угол `1.12 + 0.06·sin(0.05·t)`, дистанция `1150 + 80·sin(0.03·t)`.
  - `createOrbit(camera, dom, opts: { reducedMotion: boolean }): Orbit`, где
    `Orbit = { update(dt: number): void; applyPreset(name: ShotName): void; tourActive: boolean; dispose(): void }`.
    Тур стартует автоматически, только если `!reducedMotion` и пресет снимка не задан. Любой `pointerdown` или `wheel` останавливает тур.
    OrbitControls с `enableDamping`, `dampingFactor 0.06`.

- [ ] **Step 1: Write failing tests**

```ts
test('tour stays within orbit limits', () => {
  for (let t = 0; t < 600; t += 0.5) {
    const p = tourPose(t);
    expect(p.distance).toBeGreaterThanOrEqual(ORBIT_LIMITS.minDistance);
    expect(p.distance).toBeLessThanOrEqual(ORBIT_LIMITS.maxDistance);
    expect(p.polar).toBeLessThanOrEqual(ORBIT_LIMITS.maxPolarAngle);
  }
});
test('reduced motion disables the tour', () => {
  const o = createOrbit(new PerspectiveCamera(), fakeDom(), { reducedMotion: true });
  expect(o.tourActive).toBe(false);
});
```
(`fakeDom()` — минимальный объект с `addEventListener`/`removeEventListener`, `style` и `ownerDocument`, которого достаточно OrbitControls в node; объявить в `tests/helpers.ts`.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "engine: orbit camera, cinematic tour and shot presets"`

---

### Task 4: Время суток, небо, окружение, солнце с CSM

**Files:**
- Create: `app/src/engine/lighting/timeOfDay.ts`, `sky.ts`, `sun.ts`, `environment.ts`
- Modify: `app/src/engine/world.ts`
- Test: `app/tests/timeOfDay.test.ts`

**Interfaces:**
- Produces:
  - `type TimeOfDay = 'day'|'night'`
  - `interface LightingPreset { sunElevationDeg: number; sunAzimuthDeg: number; sunColor: number; sunIntensity: number; exposure: number; turbidity: number; rayleigh: number; envIntensity: number; fogColor: number; fogDensity: number; fogHeightFalloff: number; windowLitRatio: number; bloomThreshold: number }`
  - `PRESETS: Record<TimeOfDay, LightingPreset>`. Начальные значения (дальше подбираются по снимкам; тест фиксирует только инварианты):
    day = {32, 220, 0xfff1e0, 4.2, 1.0, 2.4, 1.2, 1.0, 0xbfd3e6, 0.00022, 0.0016, 0.04, 0.95};
    night = {38, 140, 0x9fb4ff, 0.22, 1.6, 0.1, 0.1, 0.18, 0x0d1420, 0.00035, 0.0012, 0.38, 0.62}.
  - `sunDirection(p: LightingPreset): Vector3` (единичный вектор к солнцу или луне).
  - `createSky(): { mesh: Mesh; setPreset(p: LightingPreset, t: TimeOfDay): void }`. Днём `Sky` из `three/addons/objects/Sky.js`
    (масштаб 10000). Ночью собственный ShaderMaterial: градиент, звёзды по хешу направления (≈ 3000 видимых),
    диск луны в `sunDirection`, Млечный путь как полоса шума.
  - `createEnvironment(renderer): { update(sky: Mesh): Texture; dispose(): void }`: PMREM из сцены, содержащей только клон неба.
    Результат идёт в `scene.environment`, интенсивность через `scene.environmentIntensity = p.envIntensity`.
  - `createSun(scene, camera, tier): { csm: CSM; setPreset(p): void; update(): void; setupMaterial(m: Material): void; dispose(): void }`.
    CSM из `three/addons/csm/CSM.js`: `cascades` и `shadowMapSize` из `TIER_SETTINGS`, `maxFar: 1400`, `mode: 'practical'`,
    `lightMargin: 400`. **Важно:** каждый материал мира, принимающий тени, проходит через `setupMaterial`.

- [ ] **Step 1: Write failing tests**

```ts
test('sun direction is unit and above horizon for both presets', () => {
  for (const t of ['day', 'night'] as const) {
    const d = sunDirection(PRESETS[t]);
    expect(d.length()).toBeCloseTo(1);
    expect(d.y).toBeGreaterThan(0.3);
  }
});
test('night lights more windows than day', () => expect(PRESETS.night.windowLitRatio).toBeGreaterThan(PRESETS.day.windowLitRatio));
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** модули и подключить их в `world.ts` (`setTime` переключает пресет, небо,
  окружение и CSM; экспозицию на этом шаге задаёт `renderer.toneMappingExposure`, в Task 9 она переезжает в постобработку).
  Для визуальной проверки временно добавить в сцену серую плоскость 600×600 и куб 40 м.
- [ ] **Step 4: Run** тесты → PASS. `npm run shots -- orbit-day orbit-night` → небо дневное и ночное, у куба мягкая тень, выход 0.
- [ ] **Step 5: Commit** `git commit -am "engine: physical sky, night sky, PMREM environment and cascaded sun shadows"`

---

### Task 5: Контент районов и секретов

**Files:**
- Create: `app/src/content/districts.ts`, `app/src/content/signals.ts`
- Test: `app/tests/content.test.ts`

**Interfaces:**
- Produces:
  - `interface District { id: number; name: string; displayName?: string; url: string; language: string | null; stars: number; size: number; updatedAt: string; production?: boolean; research?: boolean; privateProject?: boolean; impact?: string; capabilities?: string[]; color: string }`
  - `DISTRICTS: readonly District[]` — 16 записей дословно из v1: 10 проектов (`id` от −8 до 1) и 6 репозиториев
    (cinder, eukalpia, Pixen, PodBus, tensora, veyra) с их `id`, языком, звёздами, размером и датой из снимка
    `2026-09-04T21:33:41.841Z`. Справочник: `Experiment-*.js` v1 (деобфусцированная копия лежит в scratchpad,
    тексты копируются дословно). Цвет по индексу после сортировки по `id` из палитры v1:
    `['#ff9b69', '#83dcca', '#e9c674', '#8eabc4', '#acb980', '#de9e8b']`.
  - `type SignalId = 'cat'|'monolith'|'override'|'underworld'|'cipher'|'ghost'`
  - `SIGNALS: Record<SignalId, { name: string; message: string; hint: string }>` — дословно из v1.

- [ ] **Step 1: Write failing tests**

```ts
test('16 districts with unique ids', () => {
  expect(DISTRICTS).toHaveLength(16);
  expect(new Set(DISTRICTS.map(d => d.id)).size).toBe(16);
});
test('admissions keeps its impact line', () =>
  expect(DISTRICTS.find(d => d.name === 'qabul.turin.uz')?.impact).toBe('11,000 users'));
test('EDU AI lists five capabilities', () =>
  expect(DISTRICTS.find(d => d.name === 'EDU AI / CAU')?.capabilities).toHaveLength(5));
test('six signals with hints', () => {
  expect(Object.keys(SIGNALS)).toEqual(['cat', 'monolith', 'override', 'underworld', 'cipher', 'ghost']);
  expect(SIGNALS.monolith.message).toBe('SEVEN KNOCKS · You found the heartbeat.');
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "content: districts and signals ported verbatim from v1"`

---

### Task 6: Детерминированная раскладка города

**Files:**
- Create: `app/src/world/rng.ts`, `app/src/world/layout.ts`
- Test: `app/tests/layout.test.ts`

**Interfaces:**
- Consumes: `DISTRICTS` (Task 5).
- Produces:
  - `type Rng = () => number`, `mulberry32(seed: number): Rng` (тот же алгоритм, что `Me` в v1),
    `range(r: Rng, a: number, b: number): number`, `pick<T>(r: Rng, xs: readonly T[]): T`, `fork(r: Rng, salt: number): Rng`.
  - `interface Island { id: 'main'|'ne'|'nw'|'se'|'sw'; cx: number; cz: number; radius: number; topY: number; depth: number }`
  - `interface Street { islandId: Island['id']; ax: number; az: number; bx: number; bz: number; width: number; kind: 'avenue'|'street' }`
  - `interface Lot { id: string; islandId: Island['id']; x: number; z: number; width: number; depth: number; role: 'monolith'|'landmark'|'filler'|'plaza'|'park'; districtId?: number }`
  - `interface Bridge { from: Island['id']; to: Island['id']; ax: number; ay: number; az: number; bx: number; by: number; bz: number; width: number }`
  - `interface CityLayout { seed: number; islands: Island[]; streets: Street[]; lots: Lot[]; bridges: Bridge[] }`
  - `createLayout(seed: number, districts: readonly District[]): CityLayout`
  - `groundY(layout: CityLayout, x: number, z: number): number` — `topY` острова под точкой, иначе `NaN`.
  - `DEFAULT_SEED = 20260905`

Правила: главный остров (0, 0), радиус 260, `topY 0`, `depth 234`. Спутники на азимутах 45°/135°/225°/315° в 420 м,
радиус 100–125, `topY` от −20 до +25, `depth = radius·0.95`. Сетка улиц выровнена по осям: авеню шириной 22 м каждые 2–3 квартала,
остальные улицы 14–18 м, шаг кварталов 60–90 м. Квартал внутри окружности `radius − 18`, делится на 2–6 участков
шириной не меньше 18 м с отступом 3 м от тротуара. Центральный квартал отдан монолиту (`role: 'monolith'`),
вокруг него площадь (`plaza`). 16 ориентиров (`landmark`) раскладываются по участкам на кольце 70–210 м,
по одному на каждый сектор угла 360/16; production ближе к центру. Мосты соединяют край главного острова с краем каждого спутника.

- [ ] **Step 1: Write failing tests**

```ts
const L = createLayout(DEFAULT_SEED, DISTRICTS);
test('deterministic', () => expect(JSON.stringify(createLayout(DEFAULT_SEED, DISTRICTS))).toBe(JSON.stringify(L)));
test('main island is 520 m across', () => expect(L.islands.find(i => i.id === 'main')!.radius).toBe(260));
test('satellites sit 420 m out', () => {
  for (const i of L.islands.filter(i => i.id !== 'main')) expect(Math.hypot(i.cx, i.cz)).toBeCloseTo(420, 0);
});
test('lots do not overlap', () => expect(findOverlaps(L.lots)).toEqual([]));
test('lots stay on their island with 18 m margin', () => {
  for (const lot of L.lots) {
    const is = L.islands.find(i => i.id === lot.islandId)!;
    for (const [x, z] of lotCorners(lot)) expect(Math.hypot(x - is.cx, z - is.cz)).toBeLessThanOrEqual(is.radius - 18 + 1e-6);
  }
});
test('every district has exactly one landmark lot', () => {
  const ids = L.lots.filter(l => l.role === 'landmark').map(l => l.districtId).sort();
  expect(ids).toEqual(DISTRICTS.map(d => d.id).sort());
});
test('one monolith at the center', () => {
  const m = L.lots.filter(l => l.role === 'monolith');
  expect(m).toHaveLength(1); expect(Math.hypot(m[0].x, m[0].z)).toBeLessThan(60);
});
test('street widths within spec', () => {
  for (const s of L.streets) { expect(s.width).toBeGreaterThanOrEqual(14); expect(s.width).toBeLessThanOrEqual(22); }
});
test('four bridges', () => expect(L.bridges).toHaveLength(4));
```
(`findOverlaps` и `lotCorners` экспортируются из `layout.ts` и пригодятся в Task 7.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "world: deterministic island, street, lot and bridge layout"`

---

### Task 7: Здания: стили, массинг, геометрия, ориентиры

**Files:**
- Create: `app/src/world/buildings/styles.ts`, `massing.ts`, `geometry.ts`, `landmarks.ts`
- Test: `app/tests/buildings.test.ts`

**Interfaces:**
- Consumes: `Lot`, `CityLayout`, `Rng`, `fork` (Task 6); `District` (Task 5).
- Produces:
  - `type StyleId = 'artdeco'|'modernist'|'industrial'|'glass'`
  - `STYLES: Record<StyleId, { floorHeight: [number, number]; bayWidth: [number, number]; height: [number, number]; setbacks: boolean; index: number }>`:
    artdeco {[3.8, 4.2], [2.6, 3.2], [60, 220], true, 0}, modernist {[3.6, 3.9], [3.0, 4.2], [30, 120], false, 1},
    industrial {[4.6, 5.4], [3.6, 4.8], [12, 40], false, 2}, glass {[3.8, 4.0], [1.5, 1.8], [80, 260], true, 3}.
  - `interface Tier { cx: number; cz: number; width: number; depth: number; y0: number; y1: number }`
  - `type Crown = 'flat'|'stepped'|'spire'|'mast'`
  - `interface BuildingSpec { lotId: string; style: StyleId; floorHeight: number; bayWidth: number; tiers: Tier[]; crown: Crown; seed: number; districtId?: number; baseY: number }`
  - `planBuilding(lot: Lot, baseY: number, rng: Rng): BuildingSpec`. Высоты кратны `floorHeight`. Уступы с отступом 3–8 м
    каждые 30–45 % высоты при `setbacks`. Каждый ярус лежит внутри предыдущего.
  - `planLandmark(lot: Lot, district: District, baseY: number, rng: Rng): BuildingSpec` и `planMonolith(lot: Lot): BuildingSpec`
    (высота ровно 320, стиль artdeco, crown `'spire'`) в `landmarks.ts`. Production-ориентиры получают высоту 120–200,
    репозитории 60–110, KIRA AI — стиль glass с crown `'mast'`.
  - `interface PropInstance { kind: 'hvac'|'watertower'|'antenna'|'stairhouse'; x: number; y: number; z: number; rotY: number; scale: number }`
  - `buildBuildingGeometry(spec: BuildingSpec, rng: Rng): { walls: BufferGeometry; trims: BufferGeometry; roofs: BufferGeometry; props: PropInstance[] }`.
    Стены — вертикальные квады на каждую грань каждого яруса. `uv` = (метры вдоль стены от угла, метры от `baseY`).
    Атрибут `aBuilding: vec4` = (seed ∈ [0, 1), style.index, floorHeight, bayWidth). Trims: межэтажные пояса через
    каждые 3 этажа (выступ 0.25 м, высота 0.35 м), карниз на верху яруса (выступ 0.6 м), парапет 1.1 м, пилястры для artdeco
    через каждые 2 пролёта. Roofs: крышки ярусов. Props: 2–8 на крышу, без пересечения с парапетом.
  - `buildCity(layout: CityLayout, districts: readonly District[]): { specs: BuildingSpec[]; chunks: { key: string; walls: BufferGeometry; trims: BufferGeometry; roofs: BufferGeometry }[]; props: PropInstance[] }`.
    Геометрия сливается по чанкам: ячейки 130×130 м на остров (для отсечения по фрустуму).

- [ ] **Step 1: Write failing tests**

```ts
test('buildings stay inside their lot', () => { /* для всех specs каждый Tier внутри своего Lot с допуском 0.01 */ });
test('heights snap to floors and respect style ranges', () => { /* (y1 - baseY) / floorHeight — целое ±1e-6; высота в пределах STYLES[style].height, кроме landmark и monolith */ });
test('monolith is 320 m', () => { /* max(y1) - baseY === 320 */ });
test('wall uvs are in meters', () => { /* у квада стены шириной W: max(uv.x) - min(uv.x) ≈ W */ });
test('aBuilding encodes style and floor height', () => { /* aBuilding.y === STYLES[style].index, aBuilding.z === spec.floorHeight */ });
test('whole city fits the high triangle budget with headroom', () => { /* сумма треугольников chunks + props·200 < 3_500_000 */ });
test('every district has a landmark spec', () => { /* specs.filter(s => s.districtId !== undefined) содержит 16 уникальных id */ });
```
Assertions внутри — ровно те, что описаны в комментариях; значения берутся из `STYLES` и `layout`.

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git commit -am "world: building styles, massing, facade-ready geometry and landmarks"`

---

### Task 8: Фасадный материал: окна, interior mapping, ночь

**Files:**
- Create: `app/src/world/buildings/facadeMaterial.ts`, `app/src/world/city.ts`
- Modify: `app/src/engine/world.ts` (добавить город, убрать временные плоскость и куб)
- Test: `app/tests/facadeMaterial.test.ts`

**Interfaces:**
- Consumes: `buildCity` (Task 7), `createSun().setupMaterial` (Task 4), `TIER_SETTINGS` (Task 2).
- Produces:
  - `createFacadeMaterial(opts: { tier: QualityTier; textures: { concrete: TextureSet; steel: TextureSet; brick: TextureSet } }): FacadeMaterial`,
    где `TextureSet = { map: Texture; normalMap: Texture; armMap: Texture }`, а
    `FacadeMaterial = MeshStandardMaterial & { uniforms: { uNight: { value: number }; uLitRatio: { value: number }; uTime: { value: number } } }`.
    `customProgramCacheKey()` возвращает `facade-${tier}`.
  - `captureCityReflection(renderer, scene, at: Vector3): Texture` в `city.ts`: `CubeCamera` (256 px) в точке (0, 80, 0) →
    PMREM. Результат назначается `facade.envMap`, поэтому стёкла отражают сам город. Пересчитывается в `World.setTime`.
  - `createCityMeshes(layout, districts, ctx: { tier; sun; textures }): { group: Group; facade: FacadeMaterial; update(dt: number): void; dispose(): void }`
    в `city.ts`: по 3 меша на чанк (стены — facade, trims — бетон или сталь по стилю, крыши — бетон), props — `InstancedMesh` по виду
    (hvac — коробка с решёткой, watertower — цилиндр на опорах, antenna — тонкий цилиндр с красным огнём ночью, stairhouse — коробка).

Шейдер (`onBeforeCompile`, текстовые вставки в `#include <map_fragment>`, `<normal_fragment_maps>`,
`<roughnessmap_fragment>`, `<metalnessmap_fragment>`, `<emissivemap_fragment>`):
- Ячейка окна: `cell = floor(uv / vec2(bayWidth, floorHeight))`, локальные координаты `f = fract(...)`.
  Проём по стилю: artdeco 0.55×0.62, modernist 0.85×0.48 (ленточные), industrial 0.6×0.55, glass 0.96×0.92.
  Рама 6 см, откос: нормаль наклоняется на ребрах проёма, подоконник выступает на 4 см.
- Стекло: шероховатость 0.04, металличность 0, цвет тёмный; отражение даёт `envMap` стандартного материала.
- Interior mapping (кроме `interiorFurniture: false`): луч из камеры в касательном пространстве стены
  (касательная = `normalize(cross(vec3(0, 1, 0), normal))`), комната глубиной 0.9·floorHeight, стены, пол и потолок окрашены
  по `hash(cell, seed)`. Мебель — 1–2 силуэта-прямоугольника на задней стене (на High).
- Ночь: окно светится, если `hash(cell, seed) < uLitRatio`. Цветовая температура выбирается из 2700K/3500K/4300K,
  `emissiveIntensity` 1.5–4. Призрак `ghost` пока не делаем (этап 4).
- Непрозрачная часть стены: текстуры бетона, стали или кирпича по стилю с трипланарной выборкой, тайл 4 м.
  Грязь: вертикальные подтёки от подоконников (шум по `uv.x` × затухание вниз).

- [ ] **Step 1: Write failing test**

```ts
test('facade shader injects window grid, interior and night code', () => {
  const m = createFacadeMaterial({ tier: 'high', textures: fakeTextures() });
  const shader = fakeShader(); m.onBeforeCompile(shader, null as never);
  expect(shader.fragmentShader).toContain('/*facade:windows*/');
  expect(shader.fragmentShader).toContain('/*facade:interior*/');
  expect(shader.uniforms.uNight).toBe(m.uniforms.uNight);
});
test('low tier skips furniture', () => {
  const m = createFacadeMaterial({ tier: 'low', textures: fakeTextures() });
  const shader = fakeShader(); m.onBeforeCompile(shader, null as never);
  expect(shader.fragmentShader).not.toContain('/*facade:furniture*/');
});
```
(`fakeShader()` возвращает `{ vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} }`;
`fakeTextures()` создаёт пустые `Texture` — оба хелпера в `tests/helpers.ts`.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** тесты → PASS. `npm run shots -- orbit-day orbit-night skyline` → днём видны рамы и откосы,
  в стёклах отражается небо; ночью горит около 38 % окон с разной температурой; выход 0, `withinBudget: true`.
- [ ] **Step 5: Commit** `git commit -am "world: physical facade material with windows, interior mapping and night lights"`

---

### Task 9: Постобработка, атмосфера, облака

**Files:**
- Create: `app/src/engine/post.ts`, `app/src/engine/atmosphere/AtmosphereEffect.ts`, `app/src/engine/atmosphere/noise3d.ts`,
  `app/src/engine/atmosphere/clouds.ts`
- Modify: `app/src/engine/world.ts` (рендер через композер, `resize` обновляет композер, CSM и камеру)
- Test: `app/tests/noise3d.test.ts`

**Interfaces:**
- Consumes: `LightingPreset`, `sunDirection` (Task 4); `TIER_SETTINGS` (Task 2).
- Produces:
  - `createPost(renderer, scene, camera, tier): { setSize(w: number, h: number): void; setPreset(p: LightingPreset, sun: Vector3): void; render(dt: number): void; dispose(): void }`.
    Цепочка: `RenderPass` → `N8AOPostPass` (если `ao !== 'off'`; `halfRes` для 'half'; `aoRadius 6`, `distanceFalloff 2`, `intensity 2.2`)
    → `EffectPass(AtmosphereEffect, BloomEffect{ mipmapBlur: true, intensity: 0.9, luminanceThreshold: p.bloomThreshold }, SMAAEffect)`
    → `EffectPass(ToneMappingEffect{ mode: ToneMappingMode.AGX }, VignetteEffect{ darkness: 0.38 }, NoiseEffect{ premultiply: true, opacity 0.035 })`.
    Экспозиция: `renderer.toneMappingExposure = p.exposure` (postprocessing учитывает её в AgX).
  - `class AtmosphereEffect extends Effect` (атрибут `EffectAttribute.DEPTH`): восстанавливает мировую позицию из глубины,
    применяет экспоненциальный туман по высоте `density·exp(−falloff·(y − 0))` с интегралом вдоль луча и in-scatter
    в сторону солнца (фаза Хеньи-Гринстейна, g = 0.6). Пиксели неба (глубина = 1) не трогает. Uniforms: `fogColor`, `density`,
    `heightFalloff`, `sunDirection`, `sunColor`, матрицы камеры.
  - `generateCloudNoise(size: number, seed: number): Uint8Array` (size³, тайлящийся Perlin-Worley). Используется для `Data3DTexture`.
  - `createClouds(tier, preset): { mesh: Mesh; setPreset(p: LightingPreset, sun: Vector3): void; update(t: number): void }`.
    Плита облаков от y = −430 до y = −300, протяжённостью 9000 м. Raymarch `cloudSteps` шагов (48 / 24), поглощение
    Бира-Ламберта, свет к солнцу 6 шагов, медленный дрейф `uTime`. При `cloudSteps === 0` — 3 полупрозрачных слоя
    плоскостей с 2D-шумом. Ночью облака подсвечиваются снизу тёплым светом города (uniform `uCityGlow`).

- [ ] **Step 1: Write failing tests**

```ts
test('cloud noise is deterministic and tiles', () => {
  const a = generateCloudNoise(32, 7), b = generateCloudNoise(32, 7);
  expect(a).toEqual(b);
  const at = (x: number, y: number, z: number) => a[x + 32 * (y + 32 * z)];
  for (let i = 0; i < 32; i++) expect(Math.abs(at(0, i, 5) - at(31, i, 5))).toBeLessThan(40);
});
test('cloud noise uses the full range', () => {
  const a = generateCloudNoise(32, 7);
  expect(Math.max(...a)).toBeGreaterThan(200); expect(Math.min(...a)).toBeLessThan(50);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** тесты → PASS. `npm run shots -- orbit-day orbit-night underside` и
  `npm run shots -- --quality=low orbit-day` → выход 0 на обоих уровнях. Ресайз: shots.mjs после снимка меняет вьюпорт на 900×900,
  ждёт 3 кадра и проверяет `canvas.width === 900·dpr` и отсутствие ошибок (добавить эту проверку в shots.mjs).
- [ ] **Step 5: Commit** `git commit -am "engine: AO, bloom, AgX, height fog with sun scattering and volumetric cloud sea"`

---

### Task 10: Острова, земля, водопады, мосты

**Files:**
- Create: `app/src/world/islands/island.ts`, `waterfall.ts`, `bridge.ts`, `rockMaterial.ts`;
  `app/src/world/ground/groundMask.ts`, `groundMaterial.ts`
- Modify: `app/src/world/city.ts` (добавить острова, землю, водопады и мосты)
- Test: `app/tests/islands.test.ts`, `app/tests/groundMask.test.ts`

**Interfaces:**
- Consumes: `Island`, `Street`, `Lot`, `Bridge`, `CityLayout` (Task 6); `createSun().setupMaterial` (Task 4);
  `TextureSet` (Task 8).
- Produces:
  - `buildIslandRock(island: Island, rng: Rng): BufferGeometry`. Верх — плоское кольцо-край шириной 6 м на `topY`.
    Низ — перевёрнутый конус-профиль глубиной `island.depth` с fbm-смещением (амплитуда 12 % радиуса) и 20–40 сталактитами.
    Сегменты: 256 по окружности и 96 по глубине для главного острова, 128×48 для спутников.
  - `createRockMaterial(textures: TextureSet): MeshStandardMaterial` — трипланарная выборка текстур скалы v1, тайл 18 м,
    слой мха сверху по нормали.
  - `rasterizeGround(layout: CityLayout, islandId: Island['id'], size: number): Uint8Array` (RGBA, size², покрывает квадрат
    `2·radius`): R — асфальт, G — тротуар, B — газон/парк, A — разметка (осевые линии авеню, зебры у перекрёстков).
  - `createGroundMaterial(mask: DataTexture, island: Island): MeshStandardMaterial` — асфальт (процедурный шум,
    шероховатость 0.85 днём и 0.35 ночью), плитка тротуара 0.6 м, газон; люки по хешу.
  - `buildWaterfalls(island: Island, rng: Rng): { geometry: BufferGeometry; count: number }` — 2–4 ленты от края до y = −360,
    ширина 6–14 м. Шейдер: прокрутка шума, пена у кромки, аддитивный туман-спрайт у входа в облака.
  - `buildBridge(b: Bridge): BufferGeometry` — настил шириной `b.width`, две арочные фермы, ванты.
  - `buildRoots(island: Island, rng: Rng): BufferGeometry` — 40–80 корней из нижней трети скалы: `TubeGeometry` по
    провисающей кривой длиной 15–70 м, радиус 0.4–1.6 м, 6 сегментов по окружности. Материал как у скалы, темнее.
  - `lampPositions(layout: CityLayout): Float32Array` в `groundMask.ts` — точки вдоль обеих сторон каждой улицы с шагом 25 м,
    на высоте 7 м и с отступом 1 м от края тротуара. Ночью рисуются как `InstancedMesh` маленьких эмиссивных сфер
    (тёплые 2700K, `emissiveIntensity` 6) — их подхватывает bloom. Днём скрыты.

- [ ] **Step 1: Write failing tests**

```ts
test('island top rim is flat at topY', () => { /* все вершины с y >= topY - 0.01 лежат на y === topY ±0.01 */ });
test('island underside reaches its depth', () => { /* min(y) ≈ topY - depth, допуск 15 % */ });
test('ground mask marks streets as asphalt', () => {
  const L = createLayout(DEFAULT_SEED, DISTRICTS);
  const m = rasterizeGround(L, 'main', 512);
  const s = L.streets.find(s => s.islandId === 'main')!;
  const [px, pz] = worldToMask((s.ax + s.bx) / 2, (s.az + s.bz) / 2, L.islands[0], 512);
  expect(m[(pz * 512 + px) * 4]).toBe(255);
});
test('lots are not asphalt', () => { /* центр каждого filler-участка: R === 0 */ });
test('lamps line the streets every 25 m', () => {
  const L = createLayout(DEFAULT_SEED, DISTRICTS);
  const p = lampPositions(L);
  expect(p.length % 3).toBe(0);
  for (let i = 1; i < p.length; i += 3) expect(p[i] - groundY(L, p[i - 1], p[i + 1])).toBeCloseTo(7, 1);
});
```
(`groundY(layout, x, z): number` — высота верха острова в точке; экспортируется из `layout.ts`.)
(`worldToMask(x, z, island, size): [number, number]` экспортируется из `groundMask.ts`.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** тесты → PASS. `npm run shots -- orbit-day orbit-night underside skyline` → острова со скальным низом,
  водопады уходят в облака, мосты соединяют спутники; выход 0, `withinBudget: true`.
- [ ] **Step 5: Commit** `git commit -am "world: rock islands, street ground mask, waterfalls and truss bridges"`

---

### Task 11: Доводка изображения и приёмка этапа

**Files:**
- Modify: `app/src/engine/lighting/timeOfDay.ts` (финальные значения пресетов), остальные модули — только параметры
- Create: `docs/plans/2026-10-12-m1-acceptance.md` (снимки и цифры)

- [ ] **Step 1:** Снять `orbit-day`, `orbit-night`, `underside`, `skyline` на High и `orbit-day` на Low. Сравнить со снимком v1
  (`app/test-results/shots/` против скриншота v1 той же позиции) и подобрать экспозицию, плотность тумана, порог bloom,
  долю горящих окон, цвет облаков. Править только числа в пресетах и `TIER_SETTINGS`, не логику.
- [ ] **Step 2:** `npx vitest run` → все тесты PASS. `npm run build` → без ошибок TypeScript.
- [ ] **Step 3:** Записать в `m1-acceptance.md` таблицу: снимок → draw calls, треугольники, `withinBudget`.
- [ ] **Step 4: Commit and push**

```bash
git add -A && git commit -m "m1: tune lighting presets and record orbit acceptance shots"
git push -u origin claude/exciting-ptolemy-khsv0r
```
- [ ] **Step 5:** Отправить владельцу снимки день, ночь, снизу, skyline и «было/стало».
