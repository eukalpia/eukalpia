# Этап 4: приёмка (интерфейс v1, секреты, звук, мобильный уровень)

Дата: 2026-10-12. Снимки: `app/test-results/shots/` (`node scripts/shots.mjs [--ui=…] [--query=…] [--reduced-motion] <ракурс>`,
headless Chromium на SwiftShader; `--reduced-motion` — чтобы перелёт камеры закончился до снимка). Тесты: `npx vitest run` → 55 файлов, 389 тестов, все зелёные (после исправлений финального ревью).

## Чек-лист раздела 9 спецификации

| Пункт | Доказательство |
|---|---|
| 16 районов, тексты и ссылки v1 дословно | `content.test.ts` (16 районов, строка Admissions, 5 возможностей EDU AI, ссылки репозиториев на GitHub); `panels.test.tsx` (список, бейджи, карточки production / repository / lab); снимки `orbit-day-projects`, `orbit-day-inspect` |
| Секреты (6) в `localStorage['eukalpia:signals']` | `signals.test.ts` (ключ, порядок, порча хранилища, тосты, шестое открытие); `appSecrets.test.tsx` (кот, монолит, override, этаж −1, маяк и призрак, завершение); `secrets.test.ts` (места и подсказки v1) |
| `cat` — кот на крыше у Admissions | `secrets.test.ts` (южный парапет Admissions); снимок `secret-cat` (этап 4, задача 5) |
| `monolith` — семь стуков, blackout «THE HEARTBEAT CONTINUES» | `appSecrets.test.tsx` (каждый седьмой стук, 4,2 с); снимок `orbit-day-monolith-low` |
| `override` — Konami, «OVERRIDE ACCEPTED» | `keys.test.ts`, `appSecrets.test.tsx`; снимок `orbit-day-konami` (красное солнце, окна, рамка) |
| `underworld` — `?sector=-1` или дверь в панели автора | `url.test.ts`, `panels.test.tsx` (скрытая дверь), `appSecrets.test.tsx`; снимок `underside-sector--1` |
| `cipher` — маяк между зданиями | `secrets.test.ts` (открытая земля, не внутри зданий); снимок `secret-beacon` |
| `ghost` — ночью окно на северной стороне | `secrets.test.ts` (только ночью, северный фасад Inventar); снимок `secret-ghost-night` |
| Orbit: тур и свободная орбита | `orbit.test.ts` (тур, пределы, перелёты, свободный полёт); `appState.test.tsx` (тур из Help, перетаскивание его заканчивает) |
| Walk: 1-е и 3-е лицо, WASD / Shift / Space / F / V / L | `walk.test.ts`, `controller.test.ts`, `walkControls.test.tsx`; снимок `street-day-walk` (вид начинается без деревьев перед камерой) |
| Джойстик на телефоне | `walkControls.test.tsx` (мёртвая зона, отпускание на pointerup / cancel / потерю захвата / blur / скрытие вкладки); снимок `street-day-walk-low` (390 × 844) |
| Projects: фильтры all / production / public repositories | `panels.test.tsx` (нумерация с 01, KIRA AI ни там ни там); снимок `orbit-day-projects`, `orbit-day-projects-low` (телефон) |
| Discoveries, Help, панель автора | `panels.test.tsx`; снимки `orbit-night-discoveries`, `orbit-day-help`, `orbit-night-builder` |
| День / ночь, пауза, `prefers-reduced-motion` | `chrome.test.tsx`, `appState.test.tsx` (пауза доходит до мира, при reduced motion город стартует на паузе) |
| Эмбиент-звук только по кнопке | `sound.test.ts` (контекст только после нажатия, 4 синусоиды, gain 0.018, suspend, close); `appSound.test.tsx` (кнопка, тост при отказе) |
| «Поделиться» (URL с sector) | `url.test.ts`, `appState.test.tsx` (копирование 2,5 с, тост при отказе буфера) |
| Лифт на крышу LMS | `lift.test.ts`, `appState.test.tsx` (кнопка лифта говорит, что сделает L); снимки `lms-lift`, `lms-roof` (этап 2) |
| `?sector=street`, `?sector=-1` | `url.test.ts`, `state.test.ts`, `appState.test.tsx` |
| Открытка без WebGL | `chrome.test.tsx` (интерфейс остаётся, Walk и Ray Tracing выключены); снимки `no-webgl`, `no-webgl-phone` |
| Сообщение в консоли «A TRANSMISSION FROM THE FLOATING CITY» | `chrome.test.tsx` |
| Имя «UMARALIEV RAVSHAN RUSTAMJON O'GLI» везде одинаково | `chrome.test.tsx` (кредит, head, noscript), `panels.test.tsx` (панель автора) |
| Шрифты и палитра v1 | `src/styles.css` (действующий CSS v1), `src/app/fonts/` (IBM Plex Mono 400/500, Barlow Condensed 600, OFL); снимки панелей |
| Мобильный уровень | `quality.test.ts` (телефон и экран меньше 900 × 650 → Low и лёгкая модель UR-01); снимки `*-low` |

## Бюджеты с интерфейсом поверх

| Ракурс | Уровень | Вызовы (бюджет) | Треугольники (бюджет) |
|---|---|---|---|
| orbit-day (док, утилиты) | High | 565 (900) | 3,87 M (6 M) |
| orbit-night | High | 702 (900) | 4,79 M (6 M) |
| orbit-day + инспектор | High | 569 (900) | 4,58 M (6 M) |
| street-day, прогулка | High | 452 (900) | 4,75 M (6 M) |
| orbit-day | Low | 210 (300) | 0,82 M (1,2 M) |
| street-day | Low | 193 (300) | 0,83 M (1,2 M) |
| street-day, прогулка 390 × 844 | Low | 132 (300) | 0,75 M (1,2 M) |

## Найдено и исправлено при приёмке

- Первый кадр прогулки упирался в крону: точка появления стояла в 1,9 м перед стволом. Точка перенесена с
  линии деревьев, а листва в 1–3 м от камеры растворяется дизерингом.
- С этажа −1 подписи районов висели поверх скалы (у них нет теста глубины): теперь подпись скрыта, пока
  камера ниже земли своего района.
- Снимок blackout ловил уже погасшее сообщение: harness снимает сразу после стуков.
- Вид этажа −1 стоял внутри слоя облаков (−430…−300 м) и показывал бежевую дымку: теперь камера над
  облаками и смотрит вверх на корни островов.
- Выбранный район показывался вплотную среди крыш, башню закрывал сосед, табличка была вне кадра: теперь
  камера охватывает башню с табличкой и ищет самый низкий ракурс без помех.
- Финальное ревью (свежий ревьюер): тур из Help отменялся перелётом к обзору; смена режима не выключала
  трассировку в мире; клавиши прогулки работали за открытой панелью (Space прыгал, Esc закрывал панель и
  выходил из прогулки); быстрое вкл/выкл звука оставляло гул. Всё исправлено, каждый случай закреплён
  тестом, который сначала падал.

## Перенесено

- Тост «OVERRIDE ACCEPTED» гаснет через 5,5 с и на медленном SwiftShader не попадает в кадр; текст проверен
  тестом.
- На телефоне «SWIPE THE WORLD TO LOOK» переносится на две строки, как в v1 при той же ширине.
