# Этап 4: интерфейс v1, секреты, звук, мобильный уровень — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** весь интерфейс и все функции v1 работают в новом городе: док, утилиты, панели Projects /
Discoveries / Builder / Help, инспектор района, шесть секретов, сектора и «Поделиться», тур и свободный
полёт, звук, прогулка с джойстиком на телефоне и мобильный уровень качества.

**Architecture:** React-оболочка (`app/src/app/`) повторяет разметку и действующий CSS v1 по инвентарю
`docs/v1-ui-inventory.md` (разделы 1–4). Состояние интерфейса — один редьюсер (`app/src/app/state.ts`),
мир получает команды через расширенный `World` (сектора, фокус района, пауза, ночь, override, blackout,
pixel vision, свободный полёт, пикинг и наведение). Секреты — объекты в `app/src/world/secrets/`, их
открытия хранятся в `localStorage['eukalpia:signals']`. Звук — `app/src/app/sound.ts` (Web Audio).

**Tech Stack:** React 19, three r186, vitest + @testing-library/react, Playwright (SwiftShader),
`lucide-react` 1.41.0 (те же иконки, что в v1), шрифты v1 (woff2 из `site/assets/`, OFL).

**Spec:** `docs/specs/2026-10-12-eukalpia-v2-design.md` (раздел 9, раздел 12 п. 4).
Справочник: `docs/v1-ui-inventory.md` — дословный текст, размеры, цвета, поведение v1.

## Global Constraints

- Тексты, ссылки, метки, aria-label и title — дословно из инвентаря (раздел 2), с теми же символами
  (`·` U+00B7, `–` в `UR–01`, `−` в `FLOOR −1`). Исключение — имя: `UMARALIEV RAVSHAN RUSTAMJON O'GLI`
  (`Umaraliev Ravshan Rustamjon O'gli` там, где v1 писал `Ugli`) везде, включая meta и noscript (спец. §9).
- Визуальный язык — действующий CSS v1 (инвентарь 4.3–4.5): токены `--ink #e6e8e8`, `--muted #a6b0b5`,
  `--dim #6d7a84`, `--ember #e2b183`, `--mint #b8cabe`, `--line #b5c4cf28`; шрифты IBM Plex Mono 400/500 и
  Barlow Condensed 600; Silkscreen не грузим (в v1 он не используется).
- Иконки — lucide с размерами из инвентаря 5.2.
- Ключ хранения `eukalpia:signals`, формат — JSON-массив id в порядке открытия; чтение отбрасывает
  неизвестные id и дубликаты; ошибки хранилища молча игнорируются.
- `?sector=` понимает `street`, `-1`, `underworld`; навигация пишет `?sector=overview|street|-1` через
  `history.replaceState`, сохраняя прочие параметры.
- Звук только по кнопке: 4 синусоиды 65.41 / 98 / 130.81 / 196 Гц, общий gain 0.018.
- Бюджеты раздела 6 спецификации держатся с интерфейсом поверх (DOM не влияет на `renderer.info`, но
  знаки районов и секреты — да).
- Живой сайт (`site/`, `public/`, `.github/`) не трогаем до этапа 5.

### Сознательные отличия от v1 (квирки инвентаря 6.3)

Исправляем: 1 (строка Help с `<kbd>` — обычный текст), 2 (подпись открытки над доком), 3 (таймер тоста
сбрасывается новым сообщением), 4 (тост свободного полёта только при включении), 5 (`1 sample`),
6 (E и Help из underworld ведут в одно место — `street`), 7 (Resume при reduced motion запускает
движение), 8 (тост underworld из `?sector=-1` показывается после готовности города), 9 (у инспектора
своя рамка фокуса), 10 (pixel vision чёткий: `image-rendering: pixelated`), 13 (hover-цвет у всех
кнопок), 14 (Barlow 600 объявлен явно), 17 (метка наведения сбрасывается при уходе с канваса).
Сохраняем: 11 (классы `night`/`dawn`), 12 (канвас `role="img"`, фокусируемый), 15 (`b`/`a` Konami
чувствительны к регистру), 16 (выбор района завершает прогулку), 18 (персонаж остаётся в кадре
фото-режима).

## Review Focus

1. Панель открыта, а нажимают D, E, Space, Konami, V, L → работают только Konami и Esc (закрыть), прочее
   глушится; фокус не теряется. Тест в Task 3.
2. Повторное открытие уже найденного секрета → ни тоста, ни записи, но эффект (сектор, override,
   blackout) происходит. Тест в Task 5.
3. Повреждённый или чужой `localStorage['eukalpia:signals']` (не JSON, объект, неизвестные id, дубли,
   исключение доступа) → пустой или очищенный список, без падения. Тест в Task 5.
4. Узкий экран и тач: док без счётчиков, джойстик, кнопки JUMP/RUN/INSPECT, свайп для взгляда;
   отпускание пальца вне джойстика, `pointercancel`, потеря фокуса окна обнуляют движение. Тест в Task 6.
5. Фото-режим, прогулка, тур и свободный полёт взаимоисключают друг друга так же, как в v1 (инвентарь 1.3,
   1.4, 1.12); переключение посреди перехода камеры не оставляет мир в смешанном состоянии. Тест в Task 3.

---

### Task 1: Оболочка, шрифты, иконки и постоянный интерфейс

**Files:**
- Create: `app/src/app/fonts/` (три woff2 из `site/assets/`), `app/src/app/fonts.css`,
  `app/src/app/chrome/{Location,Utilities,Guidance,Credit,Dock,Toast,Boot}.tsx`
- Modify: `app/src/styles.css` (переписать по инвентарю 4.3), `app/src/app/App.tsx`, `app/index.html`
  (title, meta, noscript из инвентаря 2.1 с новым именем), `app/package.json` (`lucide-react` 1.41.0)
- Test: `app/tests/chrome.test.tsx`

**Interfaces:**
- Produces: `<main className="world-shell immersive-world is-exploring …">` с классами из инвентаря 1.0;
  компоненты принимают состояние и колбэки из Task 3 (`UiState`, `dispatch`).
- Фото-переключатель v1 (`Ray Tracing` + `OFF`/`ON`, под утилитами) открывает существующую `PhotoPanel`
  (f-stop, Save frame, Exit) под собой; статусы фото-режима показываются в `p.trace-status`.

- [ ] Тест: док из пяти кнопок с текстом и aria-label инвентаря 2.3; счётчики `16` и `N/6`; кнопка Walk
  disabled до готовности; утилиты с aria-label/title по состоянию (день/ночь, пауза, звук, share);
  кредит с `UMARALIEV RAVSHAN RUSTAMJON O'GLI` и ссылкой на `https://turin.uz`; boot-сообщение до готовности;
  при монтировании два `console.info` из инвентаря 2.2 (`A TRANSMISSION FROM THE FLOATING CITY` и строка маяка).
- [ ] Реализация; `npm run lint`, тест зелёный.
- [ ] Commit `ui: v1 chrome, fonts and icons`.

### Task 2: Панели, инспектор и тосты

**Files:**
- Create: `app/src/app/panels/{Panel,Projects,Discoveries,Builder,Help}.tsx`, `app/src/app/Inspector.tsx`,
  `app/src/content/builder.ts` (факты и контакты из инвентаря 2.6)
- Test: `app/tests/panels.test.tsx`

**Interfaces:**
- Consumes: `DISTRICTS`, `SIGNALS`, `SIGNAL_ORDER`; `UiState.panel`, `UiState.selected`, `UiState.signals`.
- Produces: `<dialog>` через `showModal()`, закрытие по Esc (`cancel`) и клику по подложке; одна панель
  за раз; инспектор `aside.district-inspector` получает фокус при выборе района.

- [ ] Тесты: Projects — фильтры `all` (16), `production` (9, без KIRA AI), `public repositories` (6),
  нумерация заново в каждом фильтре, бейджи `LIVE`/`LAB`/язык/`CODE`, заметка с жёсткой датой
  `04 Sept 2026`; инспектор — эйбрау, строка репозитория (`C++ · 1 star`, `Experimental · 0 stars`),
  CTA по типу, список возможностей у EDU AI / CAU; Discoveries — `N OF 6 DISCOVERIES`, заголовки и тексты
  для 0/6 и 6/6, `Unknown signal` и подсказка до открытия, сообщение после; Builder — шесть фактов, ссылки
  `target=_blank rel=noreferrer`, `tel:` без target, `MAINTENANCE / FLOOR −1`; Help — шесть строк и
  действия; тост живёт 5,5 с и новый сообщение продлевает слот (квирк 3 исправлен).
- [ ] Реализация; тесты зелёные.
- [ ] Commit `ui: projects, inspector, discoveries, builder and help panels`.

### Task 3: Состояние интерфейса, сектора, клавиатура, share, пауза

**Files:**
- Create: `app/src/app/state.ts` (редьюсер), `app/src/app/keys.ts`, `app/src/app/share.ts`
- Modify: `app/src/app/url.ts`, `app/src/app/App.tsx`, `app/src/engine/world.ts`,
  `app/src/engine/camera/orbit.ts` (сектора, фокус района, свободный полёт)
- Test: `app/tests/state.test.ts`, `app/tests/keys.test.ts`, `app/tests/orbit.test.ts` (дополнения)

**Interfaces:**
- Produces: `uiReducer(state: UiState, action: UiAction): UiState` с полями инвентаря 3.1; `go(sector)`,
  `select(id)`, `startTour()`, `toggleFly()`; `World` получает
  `setSector(sector: Sector): void`, `focusDistrict(id: number | null): void`, `setPaused(paused: boolean)`,
  `setTour(on: boolean)`, `setFly(on: boolean)`, `setPixelated(on: boolean)`.
- Камеры секторов в метрах v2: overview — текущая стартовая поза орбиты; street — над главной улицей
  у LMS; underworld — под главным островом, взгляд вверх на корни скалы. Фокус района: камера на
  `(x + 0,6h, 0,45h + 25, z + 0,7h)` → `(x, 0,5h, z)` здания-ориентира.

- [ ] Тесты: переходы редьюсера (Walk выключает фото, паузу, тур, полёт, выбор, панель; фото выключает
  прогулку, включает паузу, гасит тур и полёт; выбор района выключает прогулку, закрывает панель);
  `replaceState` пишет `?sector=`; клавиши D/E/Space глушатся при открытой панели, при прогулке и при
  свободном полёте с фокусом на канвасе; Konami работает и при открытой панели, но не в `<input>`;
  share-URL содержит только `sector`; reduced motion: пауза на старте, Resume запускает движение.
- [ ] Реализация; тесты зелёные.
- [ ] Commit `ui: sectors, keyboard, share, pause, tour and free flight`.

### Task 4: Пикинг, наведение, вывески районов, выбор района

**Files:**
- Create: `app/src/world/signs.ts` (канвас-спрайты по инвентарю 1.2), `app/src/world/picking.ts`
- Modify: `app/src/engine/world.ts`
- Test: `app/tests/signs.test.ts`, `app/tests/picking.test.ts`

**Interfaces:**
- Produces: `World.onHover(fn: (label: string | null) => void)`, `World.onPick(fn: (target: PickTarget) => void)`
  где `PickTarget = { kind: 'district'; id: number } | { kind: 'secret'; id: SecretId } | { kind: 'vehicle' }`;
  клик — не больше 5 px сдвига от `pointerdown`; вывески — текст `repo.name` в верхнем регистре, высота
  над крышей растёт по `index mod 4`; при фокусе прочие вывески 0,65, кольцо выбора у основания.

- [ ] Тесты: каждой из 16 вывесок соответствует ориентир; хит-боксы покрывают здания; луч в центр
  экрана попадает в ближайший объект; сдвиг 6 px — не клик; метка наведения — `displayName ?? name`;
  одна из капсул скайвея — `UR-07 · Meridian air taxi`: клик (не в прогулке) вешает на неё камеру
  преследования и гасит тур, любое перетаскивание или навигация отпускает её.
- [ ] Реализация; тесты зелёные; снимок orbit-day с вывесками в бюджете вызовов.
- [ ] Commit `world: district signs, picking and selection`.

### Task 5: Шесть секретов

**Files:**
- Create: `app/src/world/secrets/{cat,monolith,repeater,elevator,beacon,ghost}.ts`,
  `app/src/world/secrets/index.ts`, `app/src/app/signals.ts` (хранилище и логика открытий)
- Modify: `app/src/engine/world.ts`, `app/src/engine/lighting/*` (override-палитра), `facadeMaterial.ts`
  (цвет окон при override, чёрные окна при blackout)
- Test: `app/tests/signals.test.ts`, `app/tests/secrets.test.ts`

**Interfaces:**
- Consumes: ориентиры и монолит из раскладки; `PickTarget`.
- Produces: `loadSignals(storage): SignalId[]`, `discover(list, id): { list; toast: string | null; isNew: boolean }`;
  `World.setOverride(on)`, `World.blackout(ms)`, `World.setCompleted(on)`.
- Размещение в v2: кот — на крыше у Admissions (ходит после открытия); монолит — самая высокая башня,
  каждые 7 кликов blackout 4200 мс; ретранслятор — низкий ящик на улице главного острова (+ Konami);
  лифт без опознавательных знаков — у подножия монолита, ведёт в underworld; маяк — между зданиями,
  пульсирующий кристалл; окно-призрак — северный фасад у Inventar, только ночью.

- [ ] Тесты: хранилище (повреждённое, чужие id, дубли, исключение) — Review Focus 3; первое открытие
  пишет и тостит, повторное — нет, но эффект есть (Review Focus 2); шестое — `ALL SIGNALS FOUND · THE CITY
  REMEMBERS YOU.`; призрак не пикается днём; blackout на 7, 14, 21-м клике; override меняет `--ember`
  и `--mint` на `#ff8869` / `#ffad89`.
- [ ] Реализация; тесты зелёные; снимки: override, blackout, underworld, ночь с призраком.
- [ ] Commit `world: six discoveries`.

### Task 6: Прогулка: панель, осмотр, джойстик и тач

**Files:**
- Create: `app/src/app/walk/{WalkControls,Joystick,TouchActions}.tsx`
- Modify: `app/src/character/input.ts` (вектор джойстика, импульсы прыжка и осмотра, бег-переключатель),
  `app/src/engine/world.ts` (`World.inspect(): PickTarget | null` — луч из центра, ≤ 12 м)
- Test: `app/tests/walkControls.test.tsx`, `app/tests/joystick.test.ts`

**Interfaces:**
- Produces: `joystickVector(dx, dy, width): [number, number]` (R = 0,38 ширины, мёртвая зона 13 %);
  панель `section.walking-controls` по инвентарю 1.3, короткие подписи лифта по таблице 2.5.

- [ ] Тесты: вектор джойстика (мёртвая зона, насыщение, вверх = вперёд); сброс на `pointerup`,
  `pointercancel`, `lostpointercapture`, `blur`, `document.hidden` (Review Focus 4); подписи лифта
  длинная → короткая; панель скрыта при открытой панели или выбранном районе; F осматривает район.
- [ ] Реализация; тесты зелёные; снимки walk-desktop и walk-mobile (390×844, тач).
- [ ] Commit `ui: walking controls, joystick and touch actions`.

### Task 7: Звук и мобильный уровень

**Files:**
- Create: `app/src/app/sound.ts`
- Modify: `app/src/engine/quality.ts` (`max-width: 900px` → Low и `character-mobile.glb`), `app/src/character/model.ts`
- Test: `app/tests/sound.test.ts`, `app/tests/quality.test.ts` (дополнения)

- [ ] Тесты: звук создаёт контекст только по кнопке, 4 осциллятора и gain 0.018, выключение —
  `suspend`, ошибка → тост `Audio is unavailable in this browser. The city is still open.`;
  узкий экран выбирает Low и мобильную модель.
- [ ] Реализация; тесты зелёные; Low-снимки в бюджете.
- [ ] Commit `ui: ambient sound and the mobile tier`.

### Task 8: Приёмка этапа

**Files:**
- Create: `docs/plans/2026-10-12-m4-acceptance.md`
- Modify: `app/scripts/shots.mjs` (сценарии UI: панели, инспектор, тосты, мобильные ракурсы)

- [ ] Чек-лист раздела 9 спецификации построчно с доказательством (тест или снимок) для каждой строки.
- [ ] Снимки: орбита с доком (день/ночь), каждая панель, инспектор, override, blackout, underworld,
  прогулка (десктоп и 390×844), открытка без WebGL; бюджеты High/Low.
- [ ] Полный прогон тестов и сборки; финальное ревью ветки.
- [ ] Commit `docs: m4 acceptance`.
