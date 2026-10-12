# Этап 2: улицы вблизи, персонаж и прогулка. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Город держится вблизи (фонари, деревья, машины, трафик, балюстрады), а UR01 ходит по нему в правильных пропорциях.

**Architecture:** Уличная мебель — инстансы, разложенные чистыми функциями из `CityLayout` (тестируются в node).
Коллизии строятся одним статическим BVH (`three-mesh-bvh`) из коробок зданий, дисков земли, настилов мостов и
балюстрад. Контроллер — капсула по BVH. Персонаж — GLB UR01, процедурный аниматор на чистых функциях
(фаза походки, двухзвенная IK), камеры от 1-го и 3-го лица. Режим прогулки включается из мира и из `?sector=street`.

**Tech Stack:** как на этапе 1, плюс three-mesh-bvh 0.9.16.

**Spec:** `docs/specs/2026-10-12-eukalpia-v2-design.md` (разделы 5 «Улицы», 7, 9 «лифт на крышу LMS», 12 «Этап 2»).

## Global Constraints

- 1 единица = 1 метр. UR01 имеет рост 1,824 м, масштаб 1. Проверка: рост 1,824 м ±1 %, отношение ширины к высоте
  и глубины к высоте как в GLB ±2 % (в позе привязки).
- Контроллер: ступени до 0,35 м, гравитация 9,81 м/с², ходьба 1,6 м/с, бег 4,2 м/с, прыжок 1,1 м.
- Камеры: 3-е лицо FOV 55°, 1-е лицо FOV 70°. Штанга 3-го лица 3,6 м, не проходит сквозь стены.
- Ночью ровно 8 ближайших к камере фонарей — настоящие `PointLight` (без теней).
- Бюджеты кадра этапа 1 действуют и на уличных ракурсах: High ≤ 900 / 6 млн, Low ≤ 300 / 1,2 млн.
- Живой сайт не трогаем (`site/`, `public/`, `.github/`).

## Review Focus

1. Персонаж спавнится или телепортируется в точку без земли (край острова, мост) → он стоит на земле, а не падает в облака. Тест в Task 3.
2. Быстрый бег в угол здания, в балюстраду или в узкий проход → капсула не проходит сквозь геометрию. Тест в Task 3.
3. Камера 3-го лица у стены → штанга укорачивается и не показывает внутренность здания. Тест в Task 4.
4. Переключение день/ночь и выход из прогулки во время движения → свет фонарей и состояние ввода сбрасываются, клавиши не «залипают». Тест в Task 4.
5. GLB персонажа не загрузился (сеть, 404) → прогулка недоступна с сообщением, мир продолжает работать. Тест в Task 2.

---

### Task 1: Уличная мебель — фонари, деревья, скамейки, машины, балюстрады

**Files:**
- Create: `app/src/world/street/furniture.ts` (раскладка), `app/src/world/street/meshes.ts` (геометрия и инстансы)
- Modify: `app/src/world/terrain.ts` (подключить), `app/src/engine/world.ts` (ближайшие 8 фонарей ночью)
- Test: `app/tests/furniture.test.ts`

**Interfaces:**
- Produces:
  - `interface Placement { x: number; y: number; z: number; rotY: number; variant: number }`
  - `planFurniture(layout: CityLayout, tier: QualityTier): { lamps: Placement[]; trees: Placement[]; benches: Placement[]; parkedCars: Placement[]; railings: RailingSegment[] }`.
    Фонари берутся из `lampPositions` (этап 1, высота лампы 7 м, `y` — земля). Деревья: в зоне тротуара посередине
    между фонарями, плюс 25–40 на каждый парк (Пуассон с минимальным шагом 6 м). Low — половина деревьев.
    Скамейки — каждые 3 фонаря, лицом к улице. Машины — у бордюра на улицах (не авеню) шагом 6,5 м с пропусками
    30 % и не ближе 12 м к перекрёстку. `RailingSegment = { ax; az; bx; bz; y }` — кольцо по краю каждого острова
    на радиусе `radius − 1`, с разрывами под мосты шириной моста + 2 м.
  - `createStreetMeshes(plan, ctx: { sun: SunRig; tier: QualityTier }): { group: Group; lamps: Float32Array; setNight(n: boolean): void; dispose(): void }`
    (геометрия: столб фонаря 7 м с консолью и плафоном; дерево — 3 варианта ствола и кроны из шумовых икосфер;
    скамейка; машина — кузов с кабиной, цвет инстанса из палитры 8 цветов; балюстрада — стойки шагом 1,2 м + поручень 1,1 м).
- Consumes: `lampPositions`, `CityLayout`, `MeshBuilder`.

- [ ] **Step 1: Write failing tests**

```ts
test('trees stand on sidewalks, never on the road', () => { /* для каждого дерева на main: rasterizeGround(...)[R] === 0 в его точке */ });
test('parked cars sit on the road next to the kerb', () => { /* R === 255 в точке машины; расстояние до кромки улицы 1.0–2.4 м */ });
test('no tree, car or bench overlaps a building lot', () => { /* ни одна точка не попадает в прямоугольник участка с ролью filler/landmark/monolith */ });
test('railings ring each island with gaps for bridges', () => { /* сумма длин сегментов ≈ 2π(r−1) − Σ(ширина моста + 2) ±2 % */ });
test('low tier plants half the trees', () => { /* planFurniture(L,'low').trees.length ≈ high/2 ±10 % */ });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5:** В `world.ts` на каждом кадре ночью выбирать 8 ближайших к камере фонарей и ставить на них `PointLight`
  (тёплые 2700K, intensity 40, distance 28, decay 2). Днём лампы выключены.
- [ ] **Step 6: Commit** `git commit -am "world: street furniture, rim railings and nearest street lights"`

---

### Task 2: Персонаж UR01 — загрузка, клон скелета, проверка пропорций

**Files:**
- Create: `app/src/character/model.ts`, `app/public/models/ur01/*` (копия из `site/models/ur01/`)
- Test: `app/tests/character-model.test.ts`

**Interfaces:**
- Produces:
  - `UR01 = { height: 1.824; bones: readonly BoneName[] }`, `type BoneName` — 26 имён из GLB (`root`, `pelvis`, …, `toe.R`).
  - `characterUrl(variant: 'desktop' | 'mobile', base: string): string`
  - `loadCharacter(variant, base): Promise<CharacterModel>`, где
    `CharacterModel = { root: Group; skinned: SkinnedMesh[]; bones: Map<BoneName, Bone>; bindBounds(): Box3; dispose(): void }`.
    Клон через `SkeletonUtils.clone`. Масштаб 1. Тени: cast + receive. При ошибке загрузки — reject с понятным `Error('UR-01 could not load: …')`.
  - `measureBindPose(model): { height: number; widthRatio: number; depthRatio: number }` — сбрасывает кости в позу привязки
    (`skeleton.pose()`), считает `Box3.setFromObject(root, true)`, возвращает размеры, восстанавливает позу.
- [ ] **Step 1: Write failing tests** (node: без загрузки GLB, на синтетическом скелете из 3 костей)

```ts
test('characterUrl picks the mobile file for the low tier', () => expect(characterUrl('mobile', '/eukalpia/')).toBe('/eukalpia/models/ur01/character-mobile.glb'));
test('bone list matches the GLB rig', () => expect(UR01.bones).toHaveLength(26));
test('measureBindPose restores the animated pose', () => { /* синтетический SkinnedMesh: повернуть кость, измерить, кость вернулась */ });
test('a failed load rejects with a readable message', async () => { /* loadCharacter с несуществующим base → rejects.toThrow(/UR-01 could not load/) */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN.
- [ ] **Step 5:** Добавить в `debug.ts` `__eukalpia.character()` → `measureBindPose` и в shots.mjs проверку: рост 1,824 ±1 %,
  `widthRatio` и `depthRatio` в пределах ±2 % от значений GLB (0,466 и 0,198; ширина 0,850 и глубина 0,362 из габаритов меша).
- [ ] **Step 6: Commit** `git commit -am "character: load UR01 at true scale and check its proportions"`

---

### Task 3: Коллизии и контроллер

**Files:**
- Create: `app/src/world/collision.ts`, `app/src/character/controller.ts`
- Test: `app/tests/controller.test.ts`

**Interfaces:**
- Produces:
  - `buildCollisionWorld(layout, specs: BuildingSpec[], furniture: ReturnType<typeof planFurniture>): CollisionWorld`,
    `CollisionWorld = { bvh: MeshBVH; geometry: BufferGeometry; groundAt(x: number, z: number, fromY: number): number | null; raycast(origin: Vector3, dir: Vector3, far: number): number | null }`.
    Коллайдер: коробки ярусов зданий, крыши, диски островов, бордюры не нужны (ступень 0,35 м), настилы мостов с бортами,
    балюстрады (стенка 1,1 м), монолит, пропсы на крышах — нет.
  - `createController(world: CollisionWorld, spawn: Vector3): Controller`,
    `Controller = { position: Vector3; velocity: Vector3; grounded: boolean; yaw: number; update(dt: number, input: MoveInput): void; teleport(p: Vector3): void }`,
    `MoveInput = { forward: number; right: number; run: boolean; jump: boolean }` (оси в [−1, 1]).
    Капсула радиус 0,32, высота 1,824. Скорости и прыжок — из Global Constraints. Подшаг: dt делится на шаги ≤ 1/120 с.
    `teleport` ставит на `groundAt`, а если земли нет — к ближайшей точке на ближайшем острове.
- [ ] **Step 1: Write failing tests** (BVH в node из маленькой тестовой сцены: пол, стена, ступень 0,3 м, ступень 0,5 м, балюстрада)

```ts
test('walking into a wall stops at the wall', () => { /* 3 с вперёд со скоростью бега: x ≤ wall − radius + 0.01 */ });
test('a 0.30 m kerb is stepped up, a 0.50 m block is not', () => { ... });
test('fast running into a railing never tunnels through', () => { /* 10 с бега под углом 30°: капсула всегда по эту сторону */ });
test('a jump peaks at about 1.1 m', () => { /* max(y) − y0 ∈ [1.0, 1.2] */ });
test('teleporting over the void lands on the nearest island', () => { /* teleport((0, 0, 380)) → grounded и groundY определён */ });
test('real city spawn points stand on ground', () => { /* buildCollisionWorld(реальный город): groundAt у всех точек спавна ≠ null */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN. **Step 5: Commit** `git commit -am "world: BVH collision world and capsule character controller"`

---

### Task 4: Аниматор, камеры, режим прогулки

**Files:**
- Create: `app/src/character/gait.ts` (чистая математика), `app/src/character/animator.ts`, `app/src/character/cameras.ts`,
  `app/src/character/walk.ts` (сборка: ввод → контроллер → аниматор → камера)
- Modify: `app/src/engine/world.ts` (режимы orbit/walk, `?sector=street`), `app/src/engine/debug.ts` (пресеты `street-day`,
  `street-night`, `character-front`, `character-side`)
- Test: `app/tests/gait.test.ts`, `app/tests/walk.test.ts`

**Interfaces:**
- Produces:
  - `solveTwoBone(upper: number, lower: number, target: number): { hip: number; knee: number }` — углы в радианах; цель длиннее ноги → нога прямая.
  - `gaitPhase(distance: number, stride: number): number` в [0, 1); `footLift(phase: number, speed: number): number`.
  - `createAnimator(model: CharacterModel): { update(dt: number, s: { speed: number; grounded: boolean; verticalSpeed: number; turnRate: number; groundL: number; groundR: number }): void; reset(): void }`
    — idle (дыхание грудью 0,25 Гц), ходьба/бег через IK с подъёмом стоп, руки в противофазе, плащ отстаёт по скорости
    и повороту, прыжок и приземление (приседание 0,12 м на 0,2 с).
  - `createWalkCameras(camera, world: CollisionWorld): { mode: 'third' | 'first'; update(dt, target: Vector3, yaw: number, pitch: number): void; toggle(): void }`
    — штанга 3,6 м за спиной на высоте 1,6 м, укорачивается по `raycast` до препятствия минус 0,2 м; 1-е лицо — глаза на 1,68 м.
  - `createWalk(ctx): Walk`, `Walk = { active: boolean; enter(at?: Vector3): void; exit(): void; update(dt: number): void; dispose(): void }`
    — клавиши WASD/стрелки, Shift бег, Space прыжок, V вид, F осмотр (пока заглушка-событие), Esc выход; pointer lock по клику.
    На `blur`, `visibilitychange` и `exit` все клавиши сбрасываются.
- [ ] **Step 1: Write failing tests**

```ts
test('two-bone IK reaches a target inside the leg length', () => { /* ход: |forward kinematics − target| < 1e-4 */ });
test('an out-of-reach target straightens the leg', () => { /* knee === 0 */ });
test('gait phase advances one cycle per stride', () => { ... });
test('releasing focus clears held keys', () => { /* fake window: keydown W, blur → input.forward === 0 */ });
test('the third-person boom shortens at a wall', () => { /* мир со стеной в 2 м за спиной → дистанция камеры ≤ 1.8 */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN.
- [ ] **Step 5:** `npm run shots -- street-day street-night character-front character-side` → выход 0, проверка пропорций проходит.
- [ ] **Step 6: Commit** `git commit -am "character: procedural gait, cameras and walk mode"`

---

### Task 5: Трафик и летающий транспорт

**Files:**
- Create: `app/src/world/street/traffic.ts`
- Test: `app/tests/traffic.test.ts`

**Interfaces:**
- Produces:
  - `planTraffic(layout, count: number): Route[]`, `Route = { street: Street; lane: 1 | -1; offset: number; speed: number; color: number }` —
    машины на авеню и улицах, полоса +1 туда и −1 обратно, скорость 8–14 м/с.
  - `carPose(route: Route, t: number): { x: number; z: number; rotY: number }` — едет по своей полосе, у конца улицы
    разворачивается на встречную.
  - `planSkyways(seed: number): Skyway[]` — 6 замкнутых кольцевых маршрутов на высоте 70–160 м вокруг центра, по 4–8 капсул.
  - `createTraffic(layout, ctx): { group: Group; update(dt: number): void; setNight(n: boolean): void; dispose(): void }` —
    инстансы машин (те же меши, что у припаркованных) с фарами и стоп-сигналами ночью (эмиссивные инстансы),
    капсулы с бортовыми огнями. Count: High 260 машин, Medium 160, Low 60.
- [ ] **Step 1: Write failing tests**

```ts
test('cars stay on their street and lane', () => { /* 120 с симуляции: расстояние до оси улицы ≈ lane·w/4 ±0.5, внутри отрезка */ });
test('cars turn around at street ends instead of leaving the island', () => { ... });
test('skyways never cut through a tower', () => { /* точки маршрута вне коробок всех ярусов выше y маршрута с запасом 15 м */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN. **Step 5: Commit** `git commit -am "world: street traffic and skyway pods"`

---

### Task 6: Лифт на крышу LMS

**Files:**
- Create: `app/src/world/lift.ts`
- Modify: `app/src/character/walk.ts` (клавиша L, состояние лифта)
- Test: `app/tests/lift.test.ts`

**Interfaces:**
- Produces:
  - `planLift(spec: BuildingSpec): LiftPlan` — шахта у восточного фасада лендмарка `lms.turin.uz`: платформа 2,4×2,4 м,
    от уровня улицы до крыши верхнего яруса, переходный мостик 1,2 м на крышу.
  - `createLift(plan, collision): { group: Group; status(): { available: boolean; label: string }; call(at: 'street' | 'roof'): void; update(dt: number): number /* y платформы */ }` —
    скорость 3,2 м/с, плавный разгон и торможение; подписи как в v1: `LMS lift · locating…`, `Call LMS lift`, `Ride to LMS roof`,
    `Ride to street`, `Lift ascending`, `Lift descending`, `Lift arriving`.
- [ ] **Step 1: Write failing tests**

```ts
test('the lift reaches the roof and stops flush', () => { ... });
test('a rider on the platform rises with it', () => { /* контроллер на платформе: y игрока = y платформы ± 0.02 */ });
```
- [ ] **Step 2–4:** RED → Implement → GREEN. **Step 5: Commit** `git commit -am "world: LMS rooftop lift"`

---

### Task 7: Приёмка этапа 2

- [ ] **Step 1:** `npm run shots -- street-day street-night character-front character-side orbit-day orbit-night` и
  `--quality=low street-day` → выход 0, все `withinBudget: true`, проверка пропорций проходит.
- [ ] **Step 2:** `npx vitest run` и `npm run build` — зелёные.
- [ ] **Step 3:** Записать `docs/plans/2026-10-12-m2-acceptance.md` (таблица бюджетов, пропорции UR01, найденное и перенесённое).
- [ ] **Step 4: Commit and push.** Отправить владельцу снимки улицы днём и ночью и персонажа анфас/в профиль.
