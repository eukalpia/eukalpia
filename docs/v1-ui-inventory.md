# EUKALPIA v1: user-interface inventory

The reference for porting v1's UI 1:1 into v2. It replaces reading the obfuscated build in `/home/user/eukalpia/site/`.

**Sources.** Everything below comes from three places:

- the webcrack-deobfuscated bundles (`scratchpad/deob/*.js`: `Experiment` = React UI, `City` = canvas wrapper, `create-city` = scene/input, `character`, `ray-tracing`);
- the formatted stylesheet (`v1ui/css/exp.pretty.css`, copied from `site/assets/Experiment-DGYta9Gz.css`) and `vendor-jyMoNgwb.css` (`@font-face` rules);
- headless-Chromium runs against the served build, with computed styles read through `getComputedStyle` (raw dumps in `v1ui/session*.json`).

Screenshots are in `v1ui/*.png`; their file names are cited inline. Unless a section says otherwise, numbers are for the desktop viewport (1440×900).

v1 is a single full-screen React 19 page (`<main class="world-shell immersive-world is-exploring …">`) layered over a three.js canvas. Icons are `lucide-react` 1.41.0 (stroke icons, 24-unit viewBox, `stroke-width 2`, `currentColor`). Every icon size is given below in px, and every icon name is lucide's.

---

## 1. Layout map

### 1.0 Document skeleton and stacking

```
<main class="world-shell immersive-world is-exploring [is-walking] [is-ready] (night|dawn) [override] [blackout] [completed]">
  div.world-vignette (aria-hidden)                     z 2, pointer-events none
  div.city-stage[.is-fallback]                          z 1 (fades in when .is-ready)
     div.city-canvas > canvas (three.js)
     p.trace-status (only while Ray Tracing is on)
     div.fallback (postcard mode only)
  div.boot-message (until ready)
  div.world-location                                    z 3, top-left
  div.world-utilities                                    z 4, top-right (holds the Ray Tracing toggle below it)
  div.world-guidance                                    z 3, bottom-centre hint line
  footer.world-interface                                z 4, bottom: credit (left) + dock (right)
  section.walking-controls (walk mode only)             z 5
  aside.district-inspector (when a district is selected) z 4
  div.toast (always present, empty when idle)           z 20
  div.blackout-message (seven-knocks only)              z 6
  dialog.panel (Projects / Discoveries / Builder / Help) top layer via showModal()
</main>
```

Class toggles on `<main>`:

| class | when |
|---|---|
| `is-walking` | walk mode on |
| `is-ready` | the 3D city reported ready, or failed (then postcard mode) |
| `night` / `dawn` | day/night toggle. **`dawn` is the day state.** |
| `override` | the override signal was triggered this session (not persisted) |
| `blackout` | for 4200 ms after every 7th monolith knock |
| `completed` | all 6 signals are in localStorage |

Empty classes leave double spaces in the class string, which is harmless.

The page itself does not scroll. `.world-shell.immersive-world` is `width:100%; height:100dvh; min-height:0; overflow:hidden; background:#08111a`.

### 1.1 Boot state (before the city is ready)

Screenshot: `00-boot.png`.

- **Boot message**, centred at `top:46%; left:50%; transform:translate(-50%,-50%)`. Markup: `<div class="boot-message"><span class="boot-block"></span> ASSEMBLING THE WORLD<span class="boot-dots">...</span></div>`. It renders as an 8×8 ember square blinking at 0.6 s, then `ASSEMBLING THE WORLD`, then `...`, all separated by `gap:12px`.
- Every other piece of chrome is already rendered while the city loads. Location, utilities, guidance and dock are all visible.
- The **Walk** dock button is disabled until ready (`opacity:.4; cursor:default`).
- The guidance line already reads `CINEMATIC TOUR · DRAG TO EXPLORE` when the sector is overview.
- The canvas stage is at `opacity:0` and fades to 1 over 1.5 s on `.is-ready`.

### 1.2 Orbit mode (default)

Screenshots: `01b-orbit-motion-earlier-run.png` (motion on, tour running), `80-normal-motion-tour.png`, `scan-day.png` (reduced motion).

| Element | Position (desktop) | Content / behaviour |
|---|---|---|
| **Location** `.world-location` | `top:28px; left:30px` | `■ THE FLOATING CITY │ 000`. A 4×4 status dot, the sector title, then `.world-sector` (a small grey code after a 1px divider). Titles: overview `THE FLOATING CITY` / `000`; street `THE LIVING QUARTER` / `001`; underworld `BELOW THE SURFACE` / `-01`. `pointer-events:none`. Hidden in walk mode and at ≤600px. The sector code is hidden at ≤800px. |
| **Utilities bar** `.world-utilities` `aria-label="World settings"` | `top:18px; right:24px`. Glass bar, 4px padding, buttons 42×40 | Four buttons and a divider, listed in the next table, plus the Ray Tracing toggle hanging below the bar. |
| **Ray Tracing toggle** `button.world-trace-toggle` (child of the utilities bar) | Absolutely positioned under the bar: `top:calc(100% + 9px); right:0` (screen ≈ x1273 y76, 142×40). In walk mode `top:calc(100% + 63px)`. | sun icon 13 + `Ray Tracing` + `<small>OFF</small>` / `ON`. `title="Progressive ray-traced photo mode. Motion pauses; drag to compose."`, `aria-pressed`. Disabled (opacity .4) in postcard mode. Active state turns amber. See 1.4. |
| **Guidance line** `.world-guidance` `aria-live="off"` | Bottom-centre: `bottom:133px; left:50%; translateX(-50%)`; ≤800px `bottom:198px` | One hint line, chosen in priority order: (1) tracing: `● Ray-traced photo mode · motion paused`; (2) hovering a pickable 3D object: `● <object label>`, exactly as authored (mixed case); (3) otherwise a compass icon 12 + one of `W A S D TO FLY · Q / E ALTITUDE · DRAG TO LOOK` (free flight), `CINEMATIC TOUR · DRAG TO EXPLORE` (tour running) or `DRAG TO ORBIT · SCROLL TO EXPLORE`. Hidden in walk mode. |
| **Credit block** `section.world-credit` `aria-label="The builder"` | Bottom-left: `left:30px; bottom:25px` | Four lines: `AN INDEPENDENT WORLD BY` (6px label); `<h1><button aria-label="About Umaraliev Ravshan Rustamjon Ugli">UMARALIEV RAVSHAN RUSTAMJON UGLI ↗</button></h1>` (Barlow Condensed 600 23px, arrow-up-right 16 in amber), which **opens the Builder panel**; `AI Engineer · Systems Builder`; and the link `Turin Polytechnic University in Tashkent ↗` (arrow 10) → `https://turin.uz`, `target=_blank rel=noreferrer`. |
| **Dock** `nav.world-dock` `aria-label="City navigation"` | Bottom-right: `right:24px; bottom:25px`, 582×64, buttons 52px tall | Five buttons, listed in the dock table below. |
| **Toast** `div.toast` `role="status" aria-live="polite"` | Centred, `bottom:153px` (≤800px: 210px) | Empty when idle. A message adds a radio icon 16 and a text span; see 1.11. |
| **Canvas** | Full-bleed | `role="img" tabindex="0"` with `aria-label="Interactive floating city. Drag to orbit, scroll to zoom. Buildings and small hidden objects can be selected."` Cursor `grab`, `pointer` over a pickable object, `crosshair` in walk mode. Focus ring: 2px ember outline, inset `outline-offset:-4px`. |

**Utilities, left to right** (icons in px):

| # | Button (`.world-utility`, 42×40) | aria-label = title | Icon | Action |
|---|---|---|---|---|
| 1 | Day/night | `Switch to night` (day) / `Switch to daylight` (night) | `sun` 17 by day, `moon` 17 at night. The icon shows the **current** state. | Toggles night. |
| 2 | Motion | `Pause motion` / `Resume motion` | `pause` 16 / `play` 16 | Toggles paused. **Disabled while Ray Tracing is on** (opacity .35). |
| 3 | Sound | `Enable ambient sound` / `Mute ambient sound` | `volume-x` 17 / `volume-2` 17. Gets class `active` (amber) when on. | Toggles the ambient drone (see 3.7). |
| – | `span.world-utility-divider` | – | 1×14 line | – |
| 4 | Share | `Share this location` / `Location copied` | `copy` 16 / `check` 16, for 2.5 s after copying | Copies the share URL (see 3.6). |

**Dock buttons** (`nav.world-dock > button`; icon 18, label in a `<span>`, optional `<small>` counter):

| # | Visible text | aria-label | Icon | Action | State |
|---|---|---|---|---|---|
| 1 | `Orbit` | `Return to orbit` | `compass` | Sector → overview, closes any panel. Also ends walk, clears the selected district and focus, ends free flight and tour. | Class `active` when sector = overview **and** no panel is open: amber text, `#e4bb8d08` background, 1px amber underline (`::after`, `bottom:5px; left/right:17px`). |
| 2 | `Walk` | `Walk through the city` | `footprints` | Enters walk mode (1.3). | Disabled until ready and in postcard mode. |
| 3 | `Projects` + `<small>16</small>` | `Explore projects` | `map` | Opens the Projects panel. | The count is zero-padded to two digits. |
| 4 | `Discoveries` + `<small>N/6</small>` | `Discoveries, N of 6 found` | `radio` | Opens the Discoveries panel. | Gets class `discoveries-complete` (amber) at 6/6. |
| 5 | `Help` | `Controls and help` | `circle-question-mark` | Opens the Help panel. | – |

**3D chrome inside the canvas.** It is not DOM, but it is still UI:

- **District labels.** Each district carries a canvas-sprite sign on a thin pole (`#6a7780`) above its building. Text is the **uppercased `repo.name`**, not the display name: `QABUL.TURIN.UZ`, `LMS.TURIN.UZ`, `AR.TURIN.UZ`, `INVENTAR.UZ`, `FOTOBUDKA.UZ`, `SKUD.TURIN.UZ`, `PBX.TURIN.UZ`, `EDUWIFI.UZ`, `KIRA AI`, `EDU AI / CAU`, `PODBUS`, `CINDER`, `TENSORA`, `VEYRA`, `PIXEN`, `EUKALPIA`.
  - Drawing: `500 78px "IBM Plex Mono"` text at x27/y89 on a 128px-tall canvas. Background `rgba(8,17,25,.92)`. A 5px left bar in the district colour. Text `#e1e8e7` with a 5px glow (`shadowBlur`) in the district colour. A 1px underline at y117, inset 18px each side, district colour at 55% alpha. Canvas width = text width + 58.
  - Sprite: 1.65 world units tall, opacity 0.96, depth-tested, not tone-mapped.
  - Height above the roof = building height + 3.4 + (index mod 4) × 2.2.
  - Labels hide during blackout. When a district is focused, the other labels drop to opacity 0.65 and the focused one goes to 1.
- **LMS lift sign.** `LIFT / LMS ROOF`, same sign style, accent `#9de2c9`, scaled ×0.12, at the street lift platform.
- **Selection ring.** A flat square ring (`RingGeometry(2.4, 2.47, 4)` rotated 45°, colour `#f9ba80`, opacity .8) under the focused district.
- **Pickable objects and their hover labels.** These labels are shown in the guidance line.
  - Each district's hit-box and its sign: `displayName ?? name`, e.g. `University LMS`, `tensora`.
  - Monolith: `The monolith · listen closely`.
  - Cat: `A very suspicious cat`.
  - Elevator: `An unmarked elevator · -1`.
  - Night window: `Someone is still awake`.
  - Beacon: `65 75 6b 61 6c 70 69 61 · a familiar transmission`.
  - Repeater: `An old-school signal repeater`.
  - Hero hover-car: `UR-07 · Meridian air taxi` (hyphen-minus here, unlike the `UR–01` en dash in walk mode).

### 1.3 Walk mode

Screenshots: `50-walk-desktop.png` (3rd person), `51-walk-first-person.png`, `64-mob-walk.png`, `65-mob-walk-stick.png`.

**Entering.** Dock **Walk** sets walking on and turns off Ray Tracing, pause, tour and free flight. It also clears the selected district and closes any panel. The camera eases (1.8 s, instant under reduced motion) from the orbit pose to behind the character. The character spawns at world `[0, 0.12, 11]`, yaw 0, pitch −0.18. The camera switches to FOV 58 / near 0.035, and the canvas gets focus.

**Hidden in walk mode:**

- `footer.world-interface` (credit + dock);
- `.world-location`;
- `.world-guidance`;
- the walking controls themselves, whenever a panel is open or a district is selected (inspector showing). Their condition is `walking && !panel && !selectedDistrict`. While motion is paused the controls stay visible, but movement input is ignored (`walkActive = walking && !panel && !selected && !paused`).

**Still visible in walk mode:** the utilities bar, the Ray Tracing toggle (moved to `top:calc(100% + 63px)`) and the toast.

**Selecting a district always ends walk mode.** This applies whether you press F/INSPECT at a building or click a row in Projects-while-walking (observed: `is-walking` is removed). So the inspector never appears during walk, and the CSS rule `.immersive-world.is-walking .district-inspector{bottom:100px}` never takes effect.

`section.walking-controls` (`aria-label="Character controls"`, full-screen overlay, `pointer-events:none` except on buttons, colour `#d4dedf`):

| Element | Position | Content |
|---|---|---|
| `.walk-identity` | `top:28px; left:26px` | `■ UR–01` (en dash U+2013), then `<small>EXPLORER</small>` on a second line, then `.walk-view-label`: `THIRD PERSON` / `FIRST PERSON` after a 1px divider. The view label is hidden on touch/≤800px. |
| `.walk-toolbar` | `top:78px; left:24px`, gap 7 | Four glass buttons, 44px min-height, radius 4. See the toolbar table below. |
| `.walk-desktop-hints` | Bottom-centre, `bottom:35px` | `[W A S D] Move   [SHIFT] Run   [SPACE] Jump   [F] Inspect   Click to look · [ESC] Release` (each `[…]` is a `<kbd>`). Hidden on touch/≤800px. |
| `.walk-reticle` | Exact screen centre | A 4px dot, `#d9ece0bd`, with a soft dark shadow. `aria-hidden`. |
| `.walk-stick` (touch/≤800px only) | Bottom-left `left:max(24px,safe-left); bottom:max(42px,safe-bottom)`, 126×126 circle | `button aria-label="Movement joystick. Drag to walk."` contains a dashed inner ring, a 52px knob holding a footprints 20 icon, and the caption `MOVE` 22px below. Details in 3.10. |
| `.walk-touch-hint` (touch/≤800px only) | Right, `bottom:212px; right:24px`, right-aligned, max 140px | `SWIPE THE WORLD TO LOOK` |
| `.walk-touch-actions` (touch/≤800px only) | Bottom-right `right:max(24px,…); bottom:max(56px,…)` | See the touch-actions table below. |

**Walk toolbar buttons:**

| # | Button | aria-label | Visible | Action |
|---|---|---|---|---|
| 1 | view | `Switch to first person` / `Switch to third person` | camera 17 + `1st person` / `3rd person` + `[V]` | Toggles first person. **The label names the target view, not the current one.** |
| 2 | `.walk-lift` | The full lift status label, e.g. `LMS lift · 35m` | arrow-up-down 17 + short label (`aria-live="polite"`, ellipsised at 150px) + `[L]` | Requests the lift. Disabled unless `available`. See 3.9 for the labels. |
| 3 | projects | `Explore projects while walking` | map 17, icon only | Opens the Projects panel. |
| 4 | exit | `Leave walking mode` | log-out 17 + `Exit walk` | Leaves walk and returns to orbit (sector overview). |

**Touch action buttons** (circles, 59×59, column flex, 9px text):

| Button | aria-label | Visible | Notes |
|---|---|---|---|
| `.walk-inspect` | `Inspect what you are looking at` | scan-line 21 + `INSPECT` | 52×52, absolutely positioned above the others (`bottom:88px; right:12px`). |
| run toggle | `Switch to running` / `Switch to walking` | person-standing 23 + `WALK` / `RUN` | `aria-pressed`. Class `is-running` adds amber text and a `#3c3529cc` background. |
| `.walk-jump` | `Jump` | arrow-up 27 + `JUMP` | 75×75, amber. |

Walk inputs and keys are listed in 3.2 and 3.9.

### 1.4 Photo mode (Ray Tracing)

Screenshots: `53-ray-tracing.png`, `53b-ray-tracing-earlier-run.png`.

Clicking **Ray Tracing** sets tracing on. It also turns walk off, **forces pause on**, and turns tour and free flight off. Turning it off restores normal rendering but **leaves pause on**.

While on:

- The toggle turns amber (`border-color:#e4bb8d55`; text and `small` `#e4bb8d`) and `small` reads `ON`.
- The Pause button is disabled, and Space does not toggle pause.
- The guidance line reads `● Ray-traced photo mode · motion paused`.
- `p.trace-status` (`role="status" aria-live="polite"`) appears at `top:112px; right:24px`, max-width 240px, and shows the progress string (3.8).
- Dragging re-frames: OrbitControls stay enabled with damping off, and each camera change restarts accumulation.

If tracing was started while walking in third person, the character remains in the traced frame. If tracing fails, the toggle switches off and a toast reads `Ray tracing could not continue. Photo mode has been switched off.`

### 1.5 Projects panel (`dialog.panel.directory-panel`)

Screenshots: `11-projects-all.png`, `12-projects-production.png`, `12-projects-public-repositories.png`, `13-projects-bottom.png`, `61-mob-projects.png`.

All panels share one modal shell (1.10). Content:

- **Eyebrow:** `16 ADDRESSES · ONE CONNECTED WORLD`, where 16 is `pad2(districts.length)`.
- **Title (h2):** `Explore the projects.`
- **Description:** `Every building has a purpose. Choose an address to get closer.`
- **Filter tabs** (`.filter-tabs`). Three buttons whose DOM text is `all`, `production`, `public repositories`, shown uppercased by CSS. The active tab gets class `active`. Default is `all`, and the filter resets on every open because the panel remounts.
  - `all`: every district.
  - `production`: `repo.production === true`. 9 rows; **KIRA AI is excluded** because it is `research`, not production.
  - `public repositories`: `!production && !research`. 6 rows: PodBus, cinder, tensora, veyra, Pixen, eukalpia.
  - So KIRA AI appears only under `all`.
- **District rows** (`button.district-row`, full width, one per district in the order of `districts.ts`, i.e. sorted by id ascending):
  1. `.district-number`: `pad2(index+1)` **within the filtered list**, so numbering restarts at 01 for each filter.
  2. `.district-swatch`: 8×14, background = the district colour.
  3. `.district-row-title`: `<strong>` = `displayName ?? name`; `<small>` = `impact ?? name`. Public repos therefore repeat their name.
  4. `.district-type` badge: `LIVE` (class `live`) if production, `LAB` if research, otherwise `language ?? "CODE"` (`Dart`, `C++`, `CODE`).
  5. An arrow-up-right 16 icon.

  Clicking a row selects that district (3.5). The panel closes, walk ends if it was on, the inspector opens, and the camera flies to the building.
- **Data note** (`.data-note`): `Public repository snapshot · 04 Sept 2026. Production impact supplied by the builder.` The date is `new Date("2026-09-04T21:33:41.841Z").toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})`, so it **depends on the viewer's time zone and ICU**: `04 Sept 2026` in UTC, `05 Sept 2026` in Tashkent.

### 1.6 District inspector (`aside.district-inspector`)

Screenshots: `14-inspector-edu-ai.png`, `15-inspector-public-repo.png`, `15b-inspector-lab.png`, `27-override.png` (EDUWIFI), `62-mob-inspector.png`, `52-walk-inspector-after-row.png`.

The inspector is a non-modal card at `right:24px; bottom:120px`, 320px wide, `max-height:min(580px,100dvh − 215px)`, scrolling internally. It has `tabIndex=-1` and `aria-labelledby="district-title"`, and **receives focus** each time a district is selected. It is shown while a district is selected. Selecting a district also ends walk mode, so the inspector is never shown during walk.

Contents, top to bottom:

1. `button.inspector-close.icon-button` (x 16), `aria-label="Close district details"`, absolute `top:8px; right:8px`. It only clears the selection; the camera stays where it is.
2. `span.eyebrow`: `● IN PRODUCTION` (production), `SPEECH INTELLIGENCE LAB` (research) or `PUBLIC REPOSITORY`.
3. `h2#district-title`: `displayName ?? name`, uppercased by CSS (Barlow Condensed 29px).
4. `p`: `impact`, or for repositories `"<language ?? 'Experimental'> · <stars> star|stars"`, e.g. `C++ · 1 star` or `Experimental · 0 stars`.
5. `span.district-address`: `repo.name`, e.g. `lms.turin.uz` or `EDU AI / CAU`.
6. `ul.project-capabilities` (only when `capabilities` exists, i.e. EDU AI / CAU): one `li` per capability.
7. `a.visit-button` to `repo.url` (`target=_blank rel=noreferrer`), with label `DISCUSS THIS PROJECT` (privateProject), `VISIT PLATFORM` (production), `READ THE UNIVERSITY FEATURE` (research) or `OPEN REPOSITORY`, followed by arrow-up-right 17 pushed to the right edge.

### 1.7 Discoveries panel

Screenshots: `16-discoveries-0.png`, `17-discoveries-open-hints.png`, `30-discoveries-complete.png` (2/6), `47-discoveries-complete.png` (6/6).

- **Eyebrow:** `N OF 6 DISCOVERIES`, where N is not padded.
- **Title:** `Look a little closer.`, or `The city remembers you.` when all 6 are found.
- **Description:** `Six small secrets live in this world. No leaderboard. No rush. Your discoveries stay on this device.` When complete: `You looked a little closer. You stayed a little longer. This world is better with you in it.`
- **`.signal-grid`.** Six native `<details class="signal [found]">` in fixed order cat, monolith, override, underworld, cipher, ghost. All start closed, and several can be open at once.
  - `<summary>` holds: `<span>01</span>`; an icon (`scan-line` 17 when unfound, `check` 17 when found); `<strong>` with `Unknown signal` or the signal's name; and a `chevron-right` 14 that rotates 90° when open.
  - `<p>` holds the **hint** when unfound or the **message** when found.
  - The summary is grey (`--dim`) when unfound and `#d1b58f` when found.
- **Footer button:** `button.wide-link` with `Back to exploring` + compass 17 at the right. It closes the panel.

### 1.8 Builder (author) panel (`dialog.panel.author-panel`)

Screenshots: `19-author-top.png`, `20-author-mid.png`, `21-author-bottom.png`, `63-mob-author.png`.

- **Eyebrow:** `THE PERSON BEHIND THIS WORLD`. **Title:** `The builder.`
- **`.builder-heading`:**
  - `.builder-mark`: an 85×85 box with `RU` (Barlow 30px, amber) and a small `↗` (U+2197) at the top-right;
  - `h3`: `Umaraliev Ravshan<br>Rustamjon Ugli`;
  - `p` (amber 8px): `AI Engineer · Coordinator · Systems Builder`.
- **`.builder-bio`:** `Graduate of <strong>Turin Polytechnic University in Tashkent</strong>. I build production systems for universities and businesses, and AI solutions that solve real operational problems.`
- **`.contact-links`:**
  - `a` with send 14 + `Let's talk on Telegram` + arrow-up-right 12, linking to `https://t.me/umaraliev_ravshan`;
  - `a` with phone 14 + `+998 33 885 55 75`, linking to `tel:+998338855575`.
- **`.author-facts`:** six rows. Each row is a 118px label column plus a text column; the exact copy is in 2.6. Labels: `EDU AI / CAU`, `ENGINEERING`, `SPEECH AI`, `COLLABORATION`, `ON STAGE`, `FOUNDATIONS`.
- **`a.visit-button`:** `FOLLOW THE WORK` + git-fork 17, linking to `https://github.com/eukalpia`.
- **`button.world-maintenance`:** `MAINTENANCE / FLOOR −1` (U+2212 minus) + arrow-down 11. Small grey 7px text that turns amber on hover. It triggers the **underworld** signal and closes the panel.

### 1.9 Help panel

Screenshot: `18-help.png`.

- **Eyebrow:** `A FEW WAYS TO EXPLORE`. **Title:** `Make yourself at home.`
- **`.help-list`:** six `<p>` rows, each an amber 16px icon followed by text:
  1. compass: `Drag to orbit the city. Scroll or pinch to zoom. Click a building to meet its project.`
  2. map: `Projects opens every district with keyboard or touch. Press <kbd>D</kbd> for the directory and <kbd>E</kbd> to switch between orbit and street level.`
  3. radio: `Six discoveries reward a closer look. Open Discoveries whenever you would like a hint.`
  4. pause: `Pause ambient motion at any time. Reduced-motion settings are respected.`
  5. audio-lines: `Sound is optional and starts only when you switch it on.`
  6. arrow-down: `Even floating cities have roots. Some doors open when you know where to look.`

  **Layout quirk in row 2.** The `<p>` is `display:flex`, so the text runs and `<kbd>`s become separate flex items. The row renders as four ragged columns (`Projects opens every district with keyboard or touch. Press` | `[D]` | `for the directory and` | `[E]` | `to switch between orbit and street level.`); see `18-help.png`. Reproduce it or fix it deliberately.
- **`.world-help-actions`:** three bordered rows:
  1. compass 16 + `Start cinematic tour` + arrow-up-right 14. Sets tracing off and pause off, then sector overview with tour on, and closes the panel.
  2. map 16 + `Explore street level` + arrow 14. In street sector the label is `Return to orbit` (map icon kept). It toggles the street/overview sector and closes the panel.
  3. grid-2x2 16 + `Pixel vision` + `<span>OFF|ON</span>` (`aria-pressed`). It toggles pixelation (renderer pixel ratio 0.62) and **does not close the panel**.
- **`button.wide-link`:** `Enable free flight (keyboard)` + move-up-right 17. When free flight is on, the label is `Exit free flight`. Clicking turns tracing off, toggles fly, turns the tour off and closes the panel. It also toasts `FREE FLIGHT · Click the city, then W A S D to move. Q / E change altitude. Drag to turn.`, **even when turning flight off**.

### 1.10 Panel shell (all four panels)

The shell is a native `<dialog>` opened with `showModal()` on mount and closed on unmount, with `aria-labelledby` pointing at its h2 (React `useId`).

- **Escape** fires `cancel`, which closes the panel.
- **Clicking the backdrop** closes it, because the click target is the dialog itself.
- Only one panel can be open at a time; the state is `null|"districts"|"signals"|"author"|"help"`.
- The header is `.panel-heading`: eyebrow + h2 on the left, and the close `button.icon-button` (x 20, `aria-label="Close panel"`) on the right.
- Panel width is 690px (`max-width:min(690px,100vw−36px)`) and height `max-height:min(86dvh,830px)`. Content scrolls inside the dialog.

### 1.11 Toast, blackout, postcard

**Toast.** A single shared slot, bottom-centre. Each message sets a 5500 ms timer that clears the slot to `""`. Timers are never cancelled, so an older timer can clear a newer message early. Content is a radio 16 icon plus `<span>` text. Every toast text is listed in 2.8.

**Blackout overlay** `div.blackout-message` (`aria-live="polite"`). Screenshot: `43-blackout.png`.

- It is full-screen, `#060b11b5`, with column-centred text: `THE HEARTBEAT CONTINUES.` (Barlow Condensed 600, `clamp(25px,5vw,65px)`, ember, letter-spacing 3px), then `SIGNAL RECOVERED / SEVEN KNOCKS` (7px, letter-spacing 2px, muted).
- While it shows, the canvas stage drops to opacity .05 (`transition:opacity 1.2s`), the 3D labels and lit-window mesh hide, and window colour is forced to black.
- It lasts 4200 ms, and it **repeats on every 7th knock** (7, 14, 21…). The toast appears only the first time.

**Postcard mode** (`.city-stage.is-fallback`). Screenshots: `70-postcard-fallback.png`, `71-postcard-fallback-mobile.png`.

- **Triggers:** WebGL cannot be created; `createCity` throws; the dynamic import fails; or a `webglcontextlost` event fires.
- **What changes:** the canvas is hidden and `div.fallback` shows `<img src="/eukalpia/city-cinematic.webp" alt="A captured view of the floating 3D city">` (`object-fit:contain; width:100%; max-height:95%`) above the centred caption `POSTCARD MODE · Open Projects to explore every district.` (10px muted).
- **Controls:** Walk and Ray Tracing are disabled (opacity .4); every other control still works.
- **Quirk:** on desktop the caption sits behind the dock and vignette, at y≈849 under the 25px-bottom footer. On mobile it is clearly visible.

### 1.12 Free flight

Free flight is reached only through Help → `Enable free flight (keyboard)`. Screenshot: `32-free-flight.png`.

- The canvas gets focus.
- With the canvas focused, W/A/S/D or arrows move along the camera's forward/right vectors, E or Space rises and Q descends, at 9 units/s. Movement is clamped to a radius of 110 around the origin.
- Drag rotates as in orbit, with orbit min distance 2.
- The guidance line reads `W A S D TO FLY · Q / E ALTITUDE · DRAG TO LOOK`.
- While the canvas is focused, the global D/E/Space shortcuts are suppressed.

### 1.13 Mobile layout (≤800px; the walk touch controls also appear on any `pointer: coarse` device)

Screenshots: `60-mob-orbit.png`, `61-mob-projects.png`, `62-mob-inspector.png`, `63-mob-author.png`, `64-mob-walk.png`, `65-mob-walk-stick.png`, and `6x-land-*.png` for landscape 844×390.

- **Footer** becomes a column, `left/right:18px; bottom:max(15px,safe-bottom)`, gap 17. The credit block is left-aligned on top. Below it the **dock spans the full width** (max 520px).
- **Dock buttons** stack the icon above the label (column flex, `min-height:60px`, icon 17px). The `<small>` counters are **hidden**, so `16` and `N/6` do not show. The active underline narrows to `left/right:24%; bottom:3px`.
- **Location** shrinks to 6px with the sector code hidden, and disappears entirely at ≤600px.
- **Utilities** sit at `top:13px; right:15px` with 40×40 buttons and 15px icons. The Ray Tracing toggle still hangs under them.
- **Guidance** is 6px at `bottom:198px`.
- **Inspector** is `width:min(310px,100vw−36px); bottom:192px; right:18px; max-height:calc(100dvh − 280px)`, with a 25px h2.
- **Toast** sits at `bottom:210px`. **Panel** height is `max-height:88dvh` and its h2 is 29px.
- **Walk mode** shows the joystick, touch-action buttons and swipe hint instead of the desktop hints. The toolbar wraps, its kbds are hidden, and the walk-view label is hidden.
- **Landscape phone** (`max-height:560px and min-width:650px`): the footer goes back to a row, buttons become 42px with the icon beside the label, guidance moves to `bottom:105px`, and the inspector to `bottom:100px`.

---

## 2. Exact copy (verbatim)

**Character notes.**

- `·` is U+00B7 MIDDLE DOT everywhere (29 uses in the UI bundle).
- `…` is U+2026.
- `–` is U+2013, used only in `UR–01` and `Uzbekistan–Korea`.
- `—` is U+2014, used only in `KIRA AI — Uzbek…`.
- `−` is U+2212, used only in `MAINTENANCE / FLOOR −1`.
- `’` is U+2019, used only in the hints `builder’s` and `city’s`.
- `×` is U+00D7 (`MIMAX Software Group × AJIN Industrial`).
- `●` is U+25CF (`● IN PRODUCTION`).
- `↗` is U+2197 (builder mark).
- Every other apostrophe is ASCII `'`, and the hyphens in `FLOOR -1` and `-01` are ASCII `-`.

**Casing.** Text shown uppercase is uppercase in the source unless this section says *(CSS uppercase)*.

### 2.1 Document `<head>` / `<noscript>` (`site/index.html`)

| Field | Value |
|---|---|
| `<title>` | `EUKALPIA // The city that compiles` |
| `meta description` | `EUKALPIA — The city that compiles. An explorable world by Umaraliev Ravshan Rustamjon Ugli. Some things are meant to be found.` |
| `meta theme-color` | `#0b1015` |
| `og:type` | `website` |
| `og:title` | `EUKALPIA // The city that compiles` |
| `og:description` | `An immense floating city. Real-world projects. Six hidden signals. Enter the world of Ravshan Umaraliev.` |
| `og:url` | `https://eukalpia.github.io/eukalpia/` |
| `og:image` | `https://eukalpia.github.io/eukalpia/og.png` |
| `twitter:card` | `summary_large_image` |
| `twitter:title` | `EUKALPIA // The city that compiles` |
| `twitter:description` | `Some things are meant to be found.` |
| `twitter:image` | `https://eukalpia.github.io/eukalpia/og.png` |
| icon | `/eukalpia/favicon.svg` (`image/svg+xml`) |
| `<html lang>` | `en` |

`<noscript>`, inline-styled `padding:3rem;color:#e7ecdc;background:#0b1015;font-family:monospace`:

```html
<h1>EUKALPIA</h1><p>UMARALIEV RAVSHAN RUSTAMJON UGLI</p><p>Enable JavaScript to enter the interactive city.</p><a style="color:#f99162" href="https://github.com/eukalpia">Visit the GitHub profile</a>
```

### 2.2 Console output (on every mount)

```js
console.info("%cA TRANSMISSION FROM THE FLOATING CITY", "color:#e2b183;font-size:16px;font-family:monospace");
console.info("65 75 6b 61 6c 70 69 61\nA small beacon carries this name. Find its glow between the buildings.");
```

`65 75 6b 61 6c 70 69 61` is hex ASCII for `eukalpia`.

The app logs nothing else. three.js may add its own warnings: `THREE.Clock: This module has been deprecated…`, the MeshBVH `maxLeafTris` deprecation, and `THREE.WebGLRenderer: A WebGL context could not be created…` when WebGL is off. The character loader throws, but does not log, `Unable to load UR-01 character: <reason>` and `UR-01 bone "<name>" was not found` / `matched …`.

### 2.3 Persistent chrome

| Where | Text |
|---|---|
| Boot | `ASSEMBLING THE WORLD` + `...` |
| Location (overview / street / underworld) | `THE FLOATING CITY` `000` / `THE LIVING QUARTER` `001` / `BELOW THE SURFACE` `-01` |
| Utilities aria-label | `World settings` |
| Utility labels (aria-label = title) | `Switch to night`, `Switch to daylight`, `Pause motion`, `Resume motion`, `Enable ambient sound`, `Mute ambient sound`, `Share this location`, `Location copied` |
| Ray Tracing toggle | `Ray Tracing` + `OFF` / `ON`. title: `Progressive ray-traced photo mode. Motion pauses; drag to compose.` |
| Guidance | `CINEMATIC TOUR · DRAG TO EXPLORE`, `DRAG TO ORBIT · SCROLL TO EXPLORE`, `W A S D TO FLY · Q / E ALTITUDE · DRAG TO LOOK`, `Ray-traced photo mode · motion paused` |
| Credit | `AN INDEPENDENT WORLD BY` / `UMARALIEV RAVSHAN RUSTAMJON UGLI` (button aria-label `About Umaraliev Ravshan Rustamjon Ugli`; section aria-label `The builder`) / `AI Engineer · Systems Builder` / `Turin Polytechnic University in Tashkent` |
| Dock aria-label | `City navigation` |
| Dock buttons (text → aria-label) | `Orbit` → `Return to orbit`; `Walk` → `Walk through the city`; `Projects 16` → `Explore projects`; `Discoveries N/6` → `Discoveries, N of 6 found`; `Help` → `Controls and help` |
| Canvas aria-label (role `img`) | `Interactive floating city. Drag to orbit, scroll to zoom. Buildings and small hidden objects can be selected.` |
| Panel close aria-label | `Close panel` |
| Inspector close aria-label | `Close district details` |

The v2 spec renames the person to `UMARALIEV RAVSHAN RUSTAMJON O'GLI`. v1 uses `UGLI` / `Ugli` everywhere: credit, aria-label, builder h3, meta description and noscript.

### 2.4 3D hover labels (shown in the guidance line) and 3D signs

**Hover labels (guidance line):**

- Districts: `displayName ?? name`.
- `The monolith · listen closely`
- `A very suspicious cat`
- `An unmarked elevator · -1`
- `Someone is still awake`
- `65 75 6b 61 6c 70 69 61 · a familiar transmission`
- `An old-school signal repeater`
- `UR-07 · Meridian air taxi`

**Painted signs:** the uppercased `repo.name` per district (1.2), plus `LIFT / LMS ROOF`.

**Unused names.** The tour waypoint names exist in code but are **never displayed**:

- `The floating archipelago`
- `A thousand lights`
- `The living quarter`
- `Above the monolith`
- `The other side`
- `Beneath the surface`
- `Suspended in the unknown`

The facade mesh name `Foundry quarter · architectural facades` is never displayed either.

### 2.5 Walk mode

| Where | Text |
|---|---|
| Section aria-label | `Character controls` |
| Identity | `UR–01` / `EXPLORER` / `THIRD PERSON` or `FIRST PERSON` |
| View button | `1st person` (aria `Switch to first person`), `3rd person` (aria `Switch to third person`), kbd `V` |
| Lift button | short label + kbd `L`, aria-label = long label (3.9) |
| Projects button aria-label | `Explore projects while walking` |
| Exit button | `Exit walk` (aria `Leave walking mode`) |
| Desktop hints | `W A S D` `Move` · `SHIFT` `Run` · `SPACE` `Jump` · `F` `Inspect` · `Click to look · ` `ESC` `Release` |
| Joystick | aria `Movement joystick. Drag to walk.`, caption `MOVE` |
| Touch hint | `SWIPE THE WORLD TO LOOK` |
| Touch buttons | `INSPECT` (aria `Inspect what you are looking at`), `WALK`/`RUN` (aria `Switch to running` / `Switch to walking`), `JUMP` (aria `Jump`) |

**Lift labels.** Each long label (status / aria-label) maps to the short label shown on the button:

| Long label | Short label |
|---|---|
| `LMS lift · locating…` (initial) | `Lift · locating…` |
| `LMS lift · <n>m` | `Lift · <n>m` |
| `Ride to LMS roof` | `To roof` |
| `Ride to street` | `To street` |
| `Call LMS lift` | `Call lift` |
| `Lift ascending` | `Ascending` |
| `Lift descending` | `Descending` |
| `Lift arriving` | `Arriving` |

The short label is produced by an exact-match table, falling back to replacing `"LMS lift · "` with `"Lift · "`.

### 2.6 Panels

**Projects**

- Eyebrow: `16 ADDRESSES · ONE CONNECTED WORLD`
- Title: `Explore the projects.`
- Description: `Every building has a purpose. Choose an address to get closer.`
- Tabs: `all` / `production` / `public repositories` *(CSS uppercase)*
- Badges: `LIVE`, `LAB`, `Dart`, `C++`, `CODE`
- Note: `Public repository snapshot · 04 Sept 2026. Production impact supplied by the builder.`

Row texts are `displayName ?? name` and `impact ?? name`, from `app/src/content/districts.ts`. Observed rows in "all" order:

| # | Title | Subtitle | Badge |
|---|---|---|---|
| 01 | Admissions Platform | 11,000 users | LIVE |
| 02 | University LMS | Serving the entire university | LIVE |
| 03 | Augmented Reality | AR for publishing · Presented to the President of Uzbekistan | LIVE |
| 04 | Inventar | Inventory management · In production | LIVE |
| 05 | Fotobudka | Photo booth platform · In production | LIVE |
| 06 | SKUD / Access Control | Access-control systems used by multiple organizations | LIVE |
| 07 | PBX / Communications | Telephony platforms used by multiple organizations | LIVE |
| 08 | EDUWIFI | Original developer of the platform | LIVE |
| 09 | KIRA AI / Speech Lab | Uzbek speech intelligence · Public STT, unreleased TTS | LAB |
| 10 | EDU AI / CAU University | AI-powered assessments, fully integrated into the university LMS | LIVE |
| 11 | PodBus | PodBus | Dart |
| 12 | cinder | cinder | Dart |
| 13 | tensora | tensora | C++ |
| 14 | veyra | veyra | CODE |
| 15 | Pixen | Pixen | CODE |
| 16 | eukalpia | eukalpia | CODE |

**Inspector**

- Eyebrows: `● IN PRODUCTION`, `SPEECH INTELLIGENCE LAB`, `PUBLIC REPOSITORY`.
- Repository line: `<lang|Experimental> · <n> star` / `stars`.
- CTAs: `DISCUSS THIS PROJECT`, `VISIT PLATFORM`, `READ THE UNIVERSITY FEATURE`, `OPEN REPOSITORY`.

**Discoveries**

- Eyebrow: `<n> OF 6 DISCOVERIES`
- Titles: `Look a little closer.` / `The city remembers you.`
- Descriptions: `Six small secrets live in this world. No leaderboard. No rush. Your discoveries stay on this device.` / `You looked a little closer. You stayed a little longer. This world is better with you in it.`
- Unfound row: `Unknown signal`
- Button: `Back to exploring`

Signal names, hints and messages are in `app/src/content/signals.ts`; v1 matches it verbatim, checked against the bundle and the live DOM.

**Builder**

- Eyebrow: `THE PERSON BEHIND THIS WORLD`
- Title: `The builder.`
- Mark: `RU` + `↗`
- Name: `Umaraliev Ravshan` ⏎ `Rustamjon Ugli`
- Role: `AI Engineer · Coordinator · Systems Builder`
- Bio: `Graduate of **Turin Polytechnic University in Tashkent**. I build production systems for universities and businesses, and AI solutions that solve real operational problems.`
- Contacts: `Let's talk on Telegram` → `https://t.me/umaraliev_ravshan`; `+998 33 885 55 75` → `tel:+998338855575`.
- Facts (label → paragraph, then links). `**…**` marks `<strong>`, `⏎` marks `<br>`.

| Label | Paragraph | Links |
|---|---|---|
| `EDU AI / CAU` | `**Fully integrated into CAU University's LMS.** Turns course topics, documents, presentations and recorded lectures into ready-to-use assessments. Supports four question formats, checks answers automatically, calculates scores and explains correct answers. Teachers can prepare assessments from their own materials; students can complete them and receive feedback within the university's existing learning workflow. Supports English and Russian.` | – |
| `ENGINEERING` | `AI solutions deployed in business workflows, including **CAU University**. Additional client work is covered by non-disclosure agreements.` | – |
| `SPEECH AI` | `**KIRA AI** — Uzbek speech intelligence. Developed speech-to-text featured by TTPU, with support for Uzbek, English and Russian. Independently developed text-to-speech as well; the TTS work remains unreleased.` | `Read the university feature ↗` → `https://t.me/polito_uz/5958` |
| `COLLABORATION` | `**MIMAX Software Group × AJIN Industrial**⏎AI engineering and cross-border collaboration. The university describes the team's work on production and warehouse monitoring and AI-assisted production forecasting, in cooperation with Gyeongbuk Technopark.` | `The university's collaboration report ↗` → `https://t.me/s/polito_uz?before=7732` |
| `ON STAGE` | `**ICT WEEK Uzbekistan · Uzbekistan–Korea BPO Forum**⏎Listed as AI Engineer Coordinator at MIMAX Software Group. On September 25, 2025, presented the team's collaboration journey with AJIN at the BPO forum.` | `ICT WEEK speaker directory ↗` → `https://ictweek.uz/eng/speaker/index?page=5`; `Read the IT Park / Outsource report ↗` → `https://outsource.gov.uz/en/media/uzbekkorean-bpo-forum-in-tashkent-new-opportunities-for-outsourcing-and-partnership` |
| `FOUNDATIONS` | `Original developer of [EDUWIFI](https://eduwifi.uz). Built admissions, learning, access-control, telephony, inventory, AR and creative platforms. SKUD and PBX systems serve multiple organizations.` | (inline link) |

- Footer link: `FOLLOW THE WORK` → `https://github.com/eukalpia`
- Hidden door: `MAINTENANCE / FLOOR −1`
- All external links use `target="_blank" rel="noreferrer"`; `tel:` has no target.

**Help**

- Eyebrow: `A FEW WAYS TO EXPLORE`
- Title: `Make yourself at home.`
- Rows: the six texts in 1.9.
- Actions: `Start cinematic tour`, `Explore street level` / `Return to orbit`, `Pixel vision` + `OFF`/`ON`, `Enable free flight (keyboard)` / `Exit free flight`.

### 2.7 Status lines

**Ray tracing** (`p.trace-status`):

- `Preparing ray tracing…`: the City component's initial state, shown until the first callback.
- `Loading ray tracer · you can cancel at any time`: shown while the chunk loads.
- `Preparing geometry · <0–100>%`
- `Building light paths · <0–100>%`
- `Compiling ray-tracing shaders…`
- `Refining light · <n> samples · drag to reframe`. This uses `samples` even when n = 1, so `1 samples` really appears.

Observed sequence on SwiftShader:

1. `Preparing geometry · 0% → 3% → 24% → … 100%`
2. `Building light paths · 3% → … 96%`
3. `Compiling ray-tracing shaders…`
4. `Refining light · 0 samples · drag to reframe`, then `1 samples`, `2 samples`, …

Status updates are throttled to one per 180 ms per phase, except a phase's 100% (or a phase change), which always posts.

**Internal error messages.** These are generated but never shown, because the UI only toasts the generic text in 2.8:

- `This browser cannot create the ray-tracing worker.`
- `This graphics device does not support the floating-point buffers required for ray tracing.`
- `The scene has no supported geometry to ray trace.`
- `Ray tracing could not start on this device.`
- `Ray-tracing preparation cancelled` (an AbortError)
- `The LMS landmark is required for roof transit.` (thrown by `createCity` if lms.turin.uz is missing, which leads to postcard mode)

**Postcard caption:** `POSTCARD MODE · Open Projects to explore every district.` The image alt is `A captured view of the floating 3D city`.

### 2.8 Toasts (all of them)

| Trigger | Text |
|---|---|
| New signal: cat | `ROOFTOP RESIDENT · The city has adopted you.` |
| New signal: monolith | `SEVEN KNOCKS · You found the heartbeat.` |
| New signal: override | `OVERRIDE ACCEPTED · Welcome to the other side.` |
| New signal: underworld | `FLOOR -1 · Even floating cities have roots.` |
| New signal: cipher | `CIPHER RESOLVED · You were always meant to find this.` |
| New signal: ghost | `AFTER HOURS · Some builders never really log off.` |
| 6th signal found (replaces that signal's own message) | `ALL SIGNALS FOUND · THE CITY REMEMBERS YOU.` |
| Free flight toggled (on or off) | `FREE FLIGHT · Click the city, then W A S D to move. Q / E change altitude. Drag to turn.` |
| `AudioContext` failure | `Audio is unavailable in this browser. The city is still open.` |
| Clipboard failure | `Share this location: <full URL>` |
| Character GLB failed to load (walk aborted) | `The exploration suit could not load. Please try Walk again.` |
| Ray tracing failed | `Ray tracing could not continue. Photo mode has been switched off.` |

**Blackout overlay:** `THE HEARTBEAT CONTINUES.` / `SIGNAL RECOVERED / SEVEN KNOCKS`.

---

## 3. Behaviours and state

### 3.1 App state (React, `Experiment` root)

| State | Initial | Notes |
|---|---|---|
| `sector` | from `?sector` (3.3) | `overview` \| `street` \| `underworld` |
| `panel` | `null` | `districts` \| `signals` \| `author` \| `help` |
| `selected` (inspector) / `focus` (camera target) | `null` | Both are set together on select. Closing the inspector clears only `selected`. |
| `touring` | `sector === "overview"` | The cinematic tour therefore **starts automatically** when the page is opened at the overview. |
| `paused` | `matchMedia("(prefers-reduced-motion: reduce)").matches`, read **once** | – |
| `night` | `false` (dawn) | – |
| `sound` | `false` | – |
| `pixelated` | `false` | – |
| `tracing` | `false` | – |
| `fly` | `false` | – |
| `walking` | `false` | – |
| `firstPerson` | `false` | – |
| `running` | `false` | – |
| `override` | `false` | – |
| `blackout` | `false` | – |
| `signals` | from localStorage | – |
| `completed` | derived: `signals.length === 6` | – |
| `liftStatus` | `{label:"LMS lift · locating…", available:false, moving:false}` | – |
| `hover` | `null` | – |
| `toast` | `""` | – |
| `shareCopied` | `false` | – |
| `filter` | `"all"` | – |
| `graphicsUnavailable` | `false` | – |
| `ready` | `false` | – |
| `navigation` counter | 0 | Incremented on every sector navigation, so re-selecting the same sector re-flies the camera. |

**Sector navigation** `go(sector)` runs on Orbit, E, help actions, maintenance, underworld discovery and Exit walk. It:

- sets walking off, `navigation++`, the new sector, fly off, tour off, selected and focus `null`;
- `history.replaceState` to the current URL with `sector` set to `overview`, `street` or `-1`. Other query params are kept.

**Start cinematic tour** = `go("overview")` followed by `touring = true`.

**Select district** `select(name)` runs from a Projects row, a 3D click or F/INSPECT. It:

- sets walking off, selected = focus = name, `focusRequest++`;
- closes the panel and sets fly and tour off;
- moves focus to the inspector `<aside>` (`preventScroll`).

### 3.2 Keyboard

All keyboard handling listens on `window`.

| Key | Context | Effect |
|---|---|---|
| ↑ ↑ ↓ ↓ ← → ← → `b` `a` | Anywhere, **even with a panel open**, unless focus is in an `<input>`/`<textarea>` | Triggers **override**. Matching is on `event.key`, so `b`/`a` are case-sensitive and Shift+B does not count. A wrong key resets progress; it counts as step 1 if the wrong key is itself ArrowUp. |
| `d` / `D` | No panel open, not walking, not (free flight and canvas focused) | Opens Projects |
| `e` / `E` | Same context as `d` | Overview ↔ street, computed as `sector==="overview" ? "street" : "overview"`. **From underworld, E goes to overview.** The Help action is the reverse: `sector==="street" ? "overview" : "street"`, so from underworld it goes to street. |
| Space | Same context, and the target is not a `<button>` | `preventDefault`, then toggles pause, unless Ray Tracing is on |
| `v` / `V` (KeyV, no auto-repeat) | Walking, no panel, target not INPUT/TEXTAREA/SELECT/A, not contenteditable, not inside `form` or `dialog` | Toggles first/third person |
| W A S D / arrows (by `event.code`, so layout-independent) | Walking and walk-active | Move, relative to camera yaw |
| Shift (L or R) | Walking | Run, held |
| Space | Walking | Jump (no auto-repeat) |
| F | Walking | Inspect (no repeat): ray from screen centre, ≤12 world units, hits district / secret |
| L | Walking | Lift request (no repeat) |
| Esc | Walking with pointer lock | Browser releases pointer lock. The hint says `ESC Release`. |
| Esc | Dialog open | Native `cancel`, which closes the panel |
| W A S D / arrows, Q, E / Space | Free flight with the **canvas focused** | Fly (prevents default) |

In walk mode D/E/Space never reach the global handler: the walking branch returns early after checking V. Held keys are cleared on window blur, when pointer lock is released, and on any walk/fly mode change.

### 3.3 URL parameters

There is only one: **`sector`**.

| Value | Result |
|---|---|
| `-1` or `underworld` | `underworld`, **and triggers the underworld discovery on mount**. Its toast appears during boot, so it may expire before the city is ready on slow devices. |
| `street` | `street` |
| Anything else or absent | `overview` |

The app writes `?sector=…` with `replaceState` on navigation. `-1` is always written for underworld, never `underworld`. A plain initial load writes nothing.

**Camera per sector** (position → target, world units):

| Sector | Position | Target |
|---|---|---|
| overview | (72, 39, 88) | (0, 7, 0) |
| street | (43, 13, 35) | (0, 12, 0) |
| underworld | (43, −24, 52) | (0, −12, 0) |

On first load at the overview (motion allowed), the camera starts at (95, 49, 105) and eases into the overview pose. For other sectors it starts at (42, 30, 46). Easing is `lerp(1−e^(−2·dt))` each frame, with dt capped at 0.05 s. Under reduced motion the camera jumps straight to the pose.

### 3.4 Persistence: localStorage

- **Key** `eukalpia:signals`. **Value:** a JSON array of signal ids in **discovery order**, e.g. `["cat","cipher","override","monolith","ghost","underworld"]`. Valid ids are `cat|monolith|override|underworld|cipher|ghost`.
- **On read:** parse, keep only known ids, dedupe (`new Set`). Non-arrays or parse errors give `[]`.
- **On write:** after each *new* discovery (`JSON.stringify(list)`). Errors are swallowed, and a storage exception on read also gives `[]`.
- Nothing else is stored. Night, sound, pixel vision, override, walk view and filters all reset on reload.

### 3.5 Districts: inspector, labels, camera

- **Selecting** a district (Projects row, click on its building or sign, or F/INSPECT within 12 units while walking) opens the inspector and flies the camera.
  - Camera: position (x+14, h+10, z+17), target (x, h/2, z).
  - The square **selection ring** appears at the building's base, and the other signs fade to 0.65.
  - The cinematic tour stops, and walking stops.
- **Hover:** pointermove over the canvas raycasts the visible pickables (district hit-boxes, signs, secrets, the hover-car). The guidance line shows the label and the cursor becomes `pointer`; otherwise the guidance resets and the cursor is `grab`. Moving onto DOM UI does not clear the hover label.
- **Click vs drag:** a pointerup counts as a click only if the pointer moved ≤5px since pointerdown.
- **Vehicle:** clicking `UR-07 · Meridian air taxi` (not in walk) attaches a chase camera to the hero hover-car (min distance 2.5) and stops the tour. Any drag or navigation releases it.
- **Orbit controls:** drag rotate, right-drag or two-finger pan, wheel or pinch zoom. Damping 0.055. Distance 9–180 (2 in free flight). `maxPolarAngle = 0.84π`. `rotateSpeed` 0.65 on small screens. FOV 36 in orbit, 58 in walk.
- **Building layout and colours** come from `districts.ts`. In the city, each district has a 3.1×3.1 footprint. Its height is `min(10, 3.5 + log2(size+1)·0.34 + log2(stars+1)·0.65)` units. The first six districts by id sit at fixed slots (−7,7) (8,5) (−7,−7) (7,−7) (−12,0) (0,−12); the rest follow a golden-angle spiral at radius 20 + 7·floor((i−6)/10). Production districts get a dark rooftop crown with a `#e8c69f` light band. The computed `active` flag and `recentPushes: 94` exist but are **unused**.

### 3.6 Share

- The share URL is built as `u = new URL(location.href); u.search = ""; u.searchParams.set("sector", sector==="underworld" ? "-1" : sector)`. So it is the current URL with **only** `?sector=<overview|street|-1>`; the hash is kept.
- It is copied with `navigator.clipboard.writeText`.
- **On success** the icon becomes `check` and the label `Location copied` for 2500 ms. Observed: `http://127.0.0.1:4190/eukalpia/?sector=overview`; on GitHub Pages it would be `https://eukalpia.github.io/eukalpia/?sector=overview`.
- **On failure** the toast reads `Share this location: <url>`.

### 3.7 Sound

- **Off at start**; it is never auto-started.
- **First enable:** creates an `AudioContext` and a master `GainNode` at **0.018**. Four sine oscillators at **65.41, 98, 130.81, 196 Hz** (C2, G2, C3, G3) are started into the gain, then the context is `resume()`d.
- **Disable:** `context.suspend()`; the oscillators keep their state.
- **Unmount:** stops the oscillators and closes the context.
- **Any exception:** the toast `Audio is unavailable in this browser. The city is still open.`, and the state stays off.
- There are no other sounds: no clicks, footsteps or discovery chimes.

### 3.8 Ray tracing (UI-relevant)

- The toggle lazy-loads `ray-tracing` + `three-gpu-pathtracer`. It builds a static baked scene and a BVH in a worker, then accumulates samples.
  - Settings: tiles 4×4; render scale 0.65 (0.5 on small screens); bounces 4 (3); transmissive 3; filter glossy 0.35; MIS on.
  - Environment fallback is a gradient from `#98b5ca` to `#273b4d` when there is no HDR.
- Status strings are in 2.7. Any error turns tracing off and shows the toast.
- The frame loop is capped at 30 fps while tracing. Each camera change, and any day/night, override, blackout or completed change, restarts accumulation.
- There is no save-frame button in v1. The v2 spec adds one.

### 3.9 Walk mode and the LMS lift

- **Character:** `UR-01` from `models/ur01/character.glb`, or `character-mobile.glb` when `max-width:900px` matched at load. Scale is 0.36, so 1 m = 0.36 units, which is why lift distances are `units/0.36`.
  - It spawns at (0, 0.12, 11) and respawns there if it falls below y −38.
  - Load failure shows the toast `The exploration suit could not load. Please try Walk again.` and leaves walk.
- **Look:**
  - Desktop mouse (`pointerType mouse` and not `(pointer:coarse)`): pointer lock on pointerdown.
  - Otherwise: pointer capture, dragging on the canvas.
  - Sensitivity: yaw −0.003 rad/px, pitch −0.0025 rad/px, clamped to ±1.12 rad.
- **Camera:**
  - Third person: 2.2 units behind the head (pivot = position + 0.6 up), 0.18 lateral offset, shortened by collisions.
  - First person: eye at the head. When moving on the ground, head bob is `sin(t·13)·min(.006, speed·.003)`.
  - The character mesh hides in first person, or when the camera is closer than 0.3.
- **Movement:** `x = right`, `z = forward` from keys plus joystick, rotated by yaw. Run comes from Shift or the RUN toggle; jump from Space or the JUMP button.
- **LMS lift:**
  - A platform runs between the street (y −0.13) beside the LMS tower and a roof catwalk.
  - Boarding radius is 1.15 units around the street or roof exit; speed is 1.65 units/s.
  - Status logic, mapped to the labels in 2.5:

| Situation | Long label | `available` | `moving` |
|---|---|---|---|
| Lift moving with rider | `Lift ascending` / `Lift descending` | false | true |
| Lift moving without rider | `Lift arriving` | false | true |
| At a stop where the platform is | `Ride to LMS roof` (street) / `Ride to street` (roof) | true | false |
| At a stop where the platform is not | `Call LMS lift` | true | false |
| Elsewhere | `LMS lift · <ceil(distance to nearer exit / 0.36)>m` | false | false |

  - At spawn the label reads `LMS lift · 35m`. The mobile run read `34m` after a short joystick nudge.
  - Pressing L or the lift button while `available` either rides (rider locked to the platform, then placed at the exit) or calls the platform.
- **Pause:** pausing while walking freezes input, but the controls stay visible. Ray Tracing ends walk. Exit walk returns to the orbit overview.

### 3.10 Mobile joystick and touch actions

- On `pointerdown` the stick captures the pointer and computes the vector from its centre:
  - `R = 0.38 × width` (47.9px at 126px wide);
  - dead zone = 13% of R;
  - magnitude `min(1, (d − dead)/(R − dead))`;
  - output `[dx/d·m, −dy/d·m]`, where up is forward.
- The knob moves by `translate(x·36px, −y·36px)`; observed `translate(14.621px, -32.8972px)`.
- The stick resets to 0 on pointerup, pointercancel, lostpointercapture, window blur and `document.hidden`.
- **INSPECT** is one inspect pulse. **RUN/WALK** toggles running (state is not kept when leaving walk). **JUMP** is one jump pulse.
- Look by swiping the canvas.

### 3.11 The six discoveries (triggers and effects)

Names, hints and messages are in `signals.ts`. World coordinates are three.js units. "Screen" positions are for the reduced-motion overview at 1440×900; see `scan-day.json`.

**Common behaviour.** On a **new** id the app appends it to the list, writes localStorage and toasts the message, or `ALL SIGNALS FOUND · THE CITY REMEMBERS YOU.` if it is the 6th. Re-triggering an already-found id shows no toast and writes nothing, but its side effects (sector change, override, blackout) still run.

| # | id | How to trigger | What happens |
|---|---|---|---|
| 1 | `cat` | Click (or F at ≤12 units) the cat. It is a small boxy figure (`#e2ba87`, two `#a9ffcb` eyes) on a rooftop box at world (−10, 2.4, 9.2), near Admissions. Hit-box 1.5×1.7×1.5 centred (−10, 3, 9.2); screen ≈ (560, 500). | Toast. From then on (this session) the cat paces: x = −10 + sin(t·0.9)·1.1, moving only while motion runs. |
| 2 | `monolith` | Click the central tower. Hit-box 6×42×6 at (0, 21, 0); screen ≈ (718, 251). Every click is counted (session-only); each **7th, 14th, 21st…** click fires. | Toast (first time only). **Every** firing also shows the blackout overlay for 4200 ms: `THE HEARTBEAT CONTINUES.` / `SIGNAL RECOVERED / SEVEN KNOCKS`, stage at 5% opacity, labels and lit windows hidden. |
| 3 | `override` | (a) The Konami code (3.2), **or** (b) click the "old-school signal repeater": a low box (`#253640`, 1.5×0.9×1.5) at (−23, 0.45, 12) with four tiny lights alternating `#bd986d`/`#83bcac`. Screen ≈ (432, 500). | Toast. `<main>.override` turns on for the session. Effects: sun light `#ff3c25`; lit-window material `#ff553b`; monolith beacon cross `#ff4937`; CSS `--ember:#ff8869` and `--mint:#ffad89`, which re-colour toasts, inspector eyebrows, focus rings, panel accents and the blackout title. |
| 4 | `underworld` | (a) `?sector=-1` or `?sector=underworld` on load; (b) Builder panel → `MAINTENANCE / FLOOR −1`; (c) click the "unmarked elevator": a `#334c50` box 0.85×1.4×0.85 at (2.8, 0.7, 2.8) with an emissive `#ffb182` strip, at the monolith's foot. It is mostly hidden inside the monolith hit-box, so it is hard to pick from orbit; not reached in testing. | Toast. Sector becomes underworld: the camera goes under the island, the location reads `BELOW THE SURFACE -01`, the URL becomes `?sector=-1`. |
| 5 | `cipher` | Click the beacon: a metal post and tilted dish (`#526773`) on a `#354854` plinth at (19, 3.4, 15), with a glowing, rotating, pulsing crystal `#96d8ca`. Screen ≈ (800, 588). | Toast only. The console line `65 75 6b 61 6c 70 69 61 / A small beacon carries this name…` hints at it. |
| 6 | `ghost` | **Night only.** Click the lit window: a `#c5e5d6` 0.35×0.5 pane bobbing ±0.12 at (7, 6, −5.42), north side near Inventar. Hit-box 1.3×1.2×1.3, **invisible and unpickable by day**. Screen at night ≈ (821, 462). | Toast only. |

**Completion (6/6):**

- `<main>.completed` is set and persists across reloads (it is derived from storage).
- The Discoveries dock button turns amber, and the panel shows its completed title and text.
- The monolith beacon cross turns mint `#b9ffd8`.
- When the 6th signal arrives outside walk mode, the camera flies to (60, 38, 75) → (0, 12, 0).

### 3.12 Reduced motion

`prefers-reduced-motion: reduce` is read **once at load**, in two places:

- **React:** `paused` starts `true`, so the button shows `Resume motion` with the play icon.
- **Scene:** a separate `reduced` flag means:
  - the scene clock **never advances**, even after the user clicks Resume, because the scene animates only when `!paused && !reduced && !tracing`;
  - camera moves (sector change, focus, walk arrival, completion) are **instant**;
  - the tour never animates.

  Walking still works: movement runs regardless.
- **CSS:** a layered rule sets `* , :before, :after { transition:none!important; animation:none!important; scroll-behavior:auto!important }`.

The help text promises "Reduced-motion settings are respected."

### 3.13 Day/night, override, completed, pixel vision (scene effects)

| Effect | Day | Night |
|---|---|---|
| Hemisphere light | 0.95 | 0.45 |
| Ambient | 0.3 | 0.18 |
| Sun intensity | 3.8 | 2.2 |
| Sun colour | `#ffe1b6` | `#ffb17b` |
| Environment intensity | 0.65 | 0.38 |
| Background (HDR sky) intensity | 0.55 | 0.25 |
| Star field (240 points `#d8dac2`, size .065, opacity .6) | hidden | visible |
| Ghost window | hidden | visible |

`main.night` / `main.dawn` have **no CSS effect** in the live UI; the rules that use them target removed elements.

**Pixel vision:** the renderer pixel ratio is forced to 0.62. The canvas is upscaled with default smoothing (no `image-rendering:pixelated`), so it looks soft and low-res rather than crisp pixels. Screenshot: `31-pixel-vision.png`.

**Adaptive resolution** (not user-visible UI):

- base pixel ratio = `min(max(.1, devicePixelRatio), 1.25, sqrt(1.6e6/(w·h)))`;
- multiplied by an adaptive scale from 0.65 to 1: −0.12 after 90 frames averaging >24 ms, +0.06 after 360 frames <18.5 ms, at most once per 3.5 s;
- disabled while tracing or in pixel vision.

**Small-screen profile:** `max-width:900px` at load gives shadows at 1024 (vs 4096), the mobile GLB, half the factory facades, and the cheaper ray-trace settings.

### 3.14 Failure handling

| Failure | Handling |
|---|---|
| WebGL unavailable, `createCity` throws, import fails, or `webglcontextlost` | Postcard mode (1.11). Walk and Ray Tracing disabled, tracing and walking forced off, `is-ready` set so the boot message disappears. |
| Character load | Toast `The exploration suit could not load. Please try Walk again.`; walking off. |
| Tracing | Toast `Ray tracing could not continue. Photo mode has been switched off.`; tracing off. |
| Audio / clipboard | Toasts as in 2.8. |
| localStorage | Silently ignored. |
| Hidden tab (`document.hidden`) | The render loop skips frames; walk input resets. |

---

## 4. Visual language

### 4.0 How the v1 stylesheet cascades (read this first)

`Experiment-DGYta9Gz.css` contains two generations of styles. Order matters:

1. **Layered** rules: `@layer base, layout, components, responsive`. These come from an older "landing page" design.
2. **Unlayered** rules after them: a "cinematic" re-skin, then the `immersive-world` re-skin.

**Unlayered declarations beat every layered one regardless of specificity**, and among layers the later layer wins. As a result, many layered values are dead. Hover is the main trap:

- `button:hover { color: var(--ember) }` lives in `base`, so it loses to any rule that sets `color` on that button.
- Verified with hover tests (`sessionH.json`): **no colour change on hover** for filter tabs, signal summaries, the Ray Tracing toggle, wide-links, contact links, visit buttons, district-type badges or icon buttons. Icon buttons change only border and background.
- **Amber on hover:** district rows, the credit name, the credit link, the maintenance link and help actions. Dock and utility buttons also turn amber and gain a tinted background.

The CSS below is the **effective, de-duplicated result** for the elements that actually render, checked against `getComputedStyle`. Values are the authored hex (8-digit hex = with alpha).

### 4.1 Fonts

Fonts are self-hosted through `@fontsource` 5.3.0 in `vendor-jyMoNgwb.css`, all with `font-display:swap`. Silkscreen (latin + latin-ext) is declared there but unused (see the table).

| Family | Weights shipped | Files | Used by (live UI) |
|---|---|---|---|
| **IBM Plex Mono** | 400, 500 (latin) | `assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2` (+`-CvHOgSBP.woff`), `assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2` (+`-CB9ihrfo.woff`) | The default UI font: `:root{font-family:"IBM Plex Mono",monospace}`. **500** is used only for `<strong>` in the builder bio and facts, and for the canvas-drawn 3D signs (`500 78px "IBM Plex Mono"`). Everything else is 400. |
| **Barlow Condensed** | **600 only** (latin) | `assets/barlow-condensed-latin-600-normal-DepVgxBB.woff2` (+`-BFJEwTuo.woff`) | Credit name (600, 23px), panel h2 (34px), inspector h2 (29px, uppercase), builder mark `RU` (30px), blackout title (600, `clamp(25px,5vw,65px)`). The h2s and the mark *declare* weight 400, but with `font-synthesis:none` and only the 600 face loaded **they render in the 600 face**, so use 600 in v2. Token: `--display:"Barlow Condensed",sans-serif`. |
| **Silkscreen** | 400 | `assets/silkscreen-latin-400-normal-CtPo2yA5.woff2` (+`-D0DfPJut.woff`); latin-ext inlined as a data URI | **Not used by the live UI.** `--pixel:"Silkscreen",monospace` is referenced only by layered rules that unlayered rules override, or that target removed landing-page elements. The browser never downloads it (confirmed in the server log). |

Root text settings: `font-synthesis:none; text-rendering:optimizeLegibility; -webkit-font-smoothing:antialiased`.

**Type scale (desktop, px)**, all IBM Plex Mono 400 unless noted:

| Element | size / line-height | letter-spacing | colour | transform |
|---|---|---|---|---|
| Location title | 8 | 1.6 | `#c9d5d5a8` | (source uppercase) |
| Location sector code | 7 | 1.6 | `#b4c5cf63` | – |
| Guidance | 7 | 1.2 | `#c2cece9e` | – |
| Credit label | 6 | 2 | `#9aadb5b3` | – |
| **Credit name** | **Barlow 600 23 / 1.1** | 0.6 | `#e0e6e4` | – |
| Credit role | 8 / 1.8 | 0.6 | `#b2c1c8b0` | – |
| Credit link | 7 / 1.8 | 0.2 | `#9cabb796` | – |
| Dock label | 11 | 0.25 | `#b7c3c9` | – |
| Dock counter `<small>` | 7 | – | `#8298a4` | – |
| Ray Tracing toggle | 11 (small 8) | – | `#c0c9caba` (small `#8298a4`) | – |
| Trace status | 10 / 1.6 | – | `#b6d0c6` | – |
| Toast | 10 / 1.6 | – | `var(--mint)` `#b8cabe` | – |
| Boot message | 9 | 1.8 | `var(--ember)` | – |
| Eyebrow | 8 / 1.7 | 2 | `var(--muted)` (inspector: `var(--mint)`) | – |
| **Panel h2** | **Barlow 34 / 1.25** | 0.2 | `var(--ink)` | – |
| Panel description | 11 / 1.9 | – | `var(--muted)` | – |
| Filter tab | 9 | 0.8 | muted / ember | uppercase |
| Row title `<strong>` | 12 | – | `var(--ink)` | – |
| Row subtitle `<small>` | 9 / 1.5 | – | muted | – |
| Row number | 9 | – | `var(--dim)` | – |
| Type badge | 7 | – | muted (`LIVE`: `#c3d4c6`) | – |
| Data note | 8 / 1.7 | – | dim | – |
| **Inspector h2** | **Barlow 29 / 1.3** | 1 | `#e5e8d8` | uppercase |
| Inspector p | 11 / 1.7 | – | muted | – |
| Inspector address | 9 | – | dim | – |
| Capability li | 9 / 1.85 | – | muted | – |
| Visit button | 9 | 1.1 | ember | – |
| Signal number | 10 | – | dim / found `#d1b58f` | – |
| Signal name | 11 | – | same | – |
| Signal text | 10 / 1.9 | – | muted | – |
| Wide link | 11 | – | ember | – |
| Builder mark | Barlow 30 | 1 | ember (arrow 14) | – |
| Builder h3 | 19 / 1.4 | −0.8 | ink | – |
| Builder role | 8 / 1.7 | – | ember | – |
| Bio | 12 / 1.95 | – | `#b2bcae` (strong: ink, 500) | – |
| Contact link | 11 | – | ember | – |
| Fact label | 8 / 2.2 | 1 | ember | – |
| Fact text | 10 / 1.85 | – | muted | – |
| Fact link | 9 / 1.5 | – | ember | – |
| Maintenance | 7 | 1 | `#71848a` | – |
| Help row | 11 / 1.8 | – | muted | – |
| Help action | 10 (state 8) | – | `#c8d1d2` (icons `#dfb98c`) | – |
| `kbd` | 10 | – | muted, `1px solid var(--line)`, radius 2, padding 2px 5px | – |
| Blackout title | Barlow 600 clamp(25,5vw,65) | 3 | ember | – |
| Blackout subline | 7 | 2 | muted | – |
| Walk identity | 13 (small 9, ls 2, `#a8b7bd`) | 1 | `#d4dedf` | – |
| Walk view label | 9 | 1 | `#a9c1bb` | – |
| Walk toolbar | 11, kbd 10 | – | `#d4dedf` | – |
| Walk hints | 10 | – | `#d4dedf` | – |
| Stick caption | 10 | 2 | `#b7c9cbb3` | – |
| Touch hint | 9 / 1.7 | 1 | `#c9dbd48c` | – |
| Touch buttons | 9 (inspect 8) | – | `#c8d7d7` (jump `#ecd0a4`) | – |

### 4.2 Colour palette

**Tokens.** The effective `:root` is the unlayered block, which overrides the layered one:

```css
:root {
  color: #e5e8d8;            /* base text colour (from the layered base; never overridden) */
  background: #0b1015;
  --ink:     #e6e8e8;
  --muted:   #a6b0b5;
  --dim:     #6d7a84;
  --ember:   #e2b183;        /* the accent ("amber") */
  --mint:    #b8cabe;
  --line:    #b5c4cf28;      /* hairlines */
  --surface: #101921;        /* declared, unused by live UI */
  --pixel:   "Silkscreen", monospace;          /* unused */
  --display: "Barlow Condensed", sans-serif;
}
.override { --ember: #ff8869; --mint: #ffad89; }   /* applied on <main> */
```

The layered originals are `--ink #e5e8d8`, `--muted #9ca89d`, `--dim #68786f`, `--ember #f4ad82`, `--mint #a5d8bd`, `--line #a4b5a325`, `--surface #101d22`. Several **hard-coded** values still derive from them: `#f4ad82xx` borders on filter tabs and contacts, `#a5d8bd66` on the status-dot glow.

**Hard-coded colours in the live UI**, by role:

| Role | Values |
|---|---|
| Page / shell backgrounds | `#0b1015` (html, theme-color), `#08111a` (main) |
| Glass surfaces | utilities `#07121b73`; trace toggle `#07121b87`; trace status `#08131be6`; dock gradient `linear-gradient(135deg,#18232dd6,#08131dde)`; inspector `#0d1824eb`; panel `#0d1823f5`; toast `#102322f5`; walk buttons `#0a1822d9`; touch buttons `#0c1a25c9`; joystick `radial-gradient(#c7dddb0c,#0c1a24a6)`; knob `linear-gradient(135deg,#41525ccf,#142632df)` |
| Borders | `#b6c9d125` (utilities, trace), `#becbd032` (dock), `#bacbd21c` (dock dividers), `#c2d4dd30` (inspector), `#bfd2d437` (panel), `#9cbaa344` (toast), `#b7c9d233` (walk buttons), `#bdcfd34d` (touch), `#c1d5da47` (stick), `#c1d4d56b` (knob), `#b4c7cf28` / `#b4c7cf20` (help actions), `#f4ad8255` (contact links), `#f4ad8277` (active tab), `#f4ad8244` (builder mark), `#a5d8bd33` (LIVE badge) |
| Amber variants (hover / active) | `#e4bb8d` (utility hover/active, trace active), `#e5bd91` (dock hover/active), `#e5bd9170` (dock underline), `#dab487` (credit arrow), `#dfb98c` (help action icons), `#edc391` (walk toolbar hover), `#e6bf8c7a` (its border), `#e1c198` (knob icon), `#ecd0a4` / `#d9ba8261` (jump), `#e4bf85` / `#3c3529cc` (running), `#d1b58f` (found signal), `#d5b591ae` (guidance icon), `#cfa57b` (unused) |
| Tinted hover fills | `#e4bb8d0d` (utility), `#e4bb8d08` (dock), `#e2b18308` (help action), `#b3d5b008` (district row), `#95b9a010` (icon button), `#f4ad8208` (active tab), `#f4ad8209` (builder mark) |
| Muted texts | `#c9d5d5a8`, `#b4c5cf63`, `#c0c9caba`, `#8298a4`, `#c2cece9e`, `#9aadb5b3`, `#b2c1c8b0`, `#9cabb796`, `#b7c3c9`, `#c8d1d2`, `#71848a`, `#b2bcae`, `#c3d4c6`, `#b6d0c6`, `#a8b7bd`, `#a9c1bb`, `#a6b5b8`, `#b7c9cbb3`, `#c9dbd48c`, `#c8d7d7`, `#d4dedf`, `#e0e6e4` |
| Status dots | default `var(--mint)` with `0 0 8px #a5d8bd66`; location `#b2cabc` with `0 0 9px #b2cabc33` |
| Overlays | blackout `#060b11b5`; panel backdrop `#020a12aa` + `blur(13px)`; vignette gradients (4.3) |
| Selection | `::selection { color:#fff; background:#f4ad8255 }` |
| Scrollbar (WebKit) | 5px wide; thumb `#7c8f7455`, radius 3; transparent track |

**District palette** (row swatches, sign accents and building tint): `['#ff9b69','#83dcca','#e9c674','#8eabc4','#acb980','#de9e8b']`, cycled by index after sorting by id. It is already in `districts.ts`.

**3D UI colours:**

| Item | Colour |
|---|---|
| Sign background | `rgba(8,17,25,.92)` |
| Sign text | `#e1e8e7` |
| Sign pole | `#6a7780` |
| Lift sign and lift glow | `#9de2c9` |
| Selection ring | `#f9ba80` @ .8 |
| Monolith beacon cross (normal / override / completed) | `#f5b88d` / `#ff4937` / `#b9ffd8` |
| Beacon gem | `#bbf0d0`, emissive `#679f80` |
| Fog | `#172531`, density .0045 |
| Production crown band | `#e8c69f` |

### 4.3 Effective CSS (desktop), cleaned up

The two kinds of hover rule are marked inline:

- `/* hover: base */` means the inherited `button:hover{color:var(--ember)}` / `a:hover` applies;
- `/* no hover colour */` means it is overridden.

```css
/* ---------- base ---------- */
* { box-sizing: border-box; }  body { margin: 0; }
h1, h2, h3, p { margin: 0; }
button, input, a { -webkit-tap-highlight-color: transparent; }
button, input { font: inherit; }
button, a { touch-action: manipulation; }
button { cursor: pointer; color: inherit; background: none; border: 0;
         transition: color .18s, background .18s, transform .18s; }   /* UA padding 1px 6px is kept */
button:disabled { cursor: wait; }            /* dock / utility / trace override this to `default` */
button:hover, a:hover { color: var(--ember); }
button:active { transform: translateY(1px); }
a { color: inherit; text-decoration: none; }
button svg, a svg { flex-shrink: 0; }
button:focus-visible, a:focus-visible, input:focus-visible, summary:focus-visible, canvas:focus-visible {
  outline: 2px solid var(--ember); outline-offset: 5px; }
.city-canvas canvas { outline-offset: -4px; }       /* canvas focus ring drawn inside the edge */
kbd { border: 1px solid var(--line); color: var(--muted); border-radius: 2px; padding: 2px 5px;
      font: 10px "IBM Plex Mono", monospace; }
::selection { color: #fff; background: #f4ad8255; }
::-webkit-scrollbar { width: 5px } ::-webkit-scrollbar-track { background: none }
::-webkit-scrollbar-thumb { background: #7c8f7455; border-radius: 3px }

/* ---------- shell ---------- */
.world-shell.immersive-world { position: relative; isolation: isolate; width: 100%; height: 100dvh;
  min-height: 0; overflow: hidden; background: #08111a; }
.world-vignette { position: absolute; inset: 0; z-index: 2; pointer-events: none;
  background: linear-gradient(#0000 65%, #060e1824 81%, #060e18e6),
              linear-gradient(#060e1861, #0000 15%); }
.city-stage { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1;
  opacity: 0; transition: opacity 1.5s; }
.is-ready .city-stage { opacity: 1; }
.blackout .city-stage { opacity: .05; transition: opacity 1.2s; }
.city-canvas { position: relative; width: 100%; height: 100%; }
.city-canvas canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.is-fallback .city-canvas { display: none; }
.fallback { position: absolute; inset: 0; display: grid; align-content: center; pointer-events: none; }
.fallback img { width: 100%; max-height: 95%; object-fit: contain; }
.fallback p { color: var(--muted); text-align: center; font-size: 10px; }
.trace-status { position: absolute; top: 112px; right: 24px; z-index: 3; max-width: 240px; margin: 0;
  padding: 9px 12px; pointer-events: none; font: 10px/1.6 "IBM Plex Mono", monospace; color: #b6d0c6;
  background: #08131be6; border: 1px solid #b6c9d125; }
.boot-message { position: absolute; top: 46%; left: 50%; transform: translate(-50%, -50%); z-index: 2;
  display: flex; align-items: center; gap: 12px; white-space: nowrap;
  color: var(--ember); font-size: 9px; letter-spacing: 1.8px; }
.boot-block { width: 8px; height: 8px; background: var(--ember); animation: blink .6s infinite; }
.status-dot { display: inline-block; flex-shrink: 0; width: 5px; height: 5px;
  background: var(--mint); box-shadow: 0 0 8px #a5d8bd66; }

/* ---------- top-left location ---------- */
.world-location { position: absolute; top: 28px; left: 30px; z-index: 3; display: flex; align-items: center;
  gap: 10px; pointer-events: none; color: #c9d5d5a8; font-size: 8px; letter-spacing: 1.6px;
  text-shadow: 0 1px 8px #05101b; }
.world-location .status-dot { width: 4px; height: 4px; background: #b2cabc; box-shadow: 0 0 9px #b2cabc33; }
.world-sector { margin-left: 6px; padding-left: 15px; border-left: 1px solid #b4c5cf35;
  color: #b4c5cf63; font-size: 7px; }

/* ---------- top-right utilities ---------- */
.world-utilities { position: absolute; top: 18px; right: 24px; z-index: 4; display: flex; align-items: center;
  gap: 2px; padding: 4px; background: #07121b73; border: 1px solid #b6c9d125; border-radius: 4px;
  backdrop-filter: blur(16px); }
.world-utility { display: grid; place-items: center; width: 42px; height: 40px; border-radius: 2px;
  color: #c0c9caba; }
.world-utility:hover, .world-utility.active { color: #e4bb8d; background: #e4bb8d0d; }
.world-utility:disabled { opacity: .35; cursor: default; }
.world-utility-divider { width: 1px; height: 14px; margin: 0 4px; background: #b6c9d129; }
.world-trace-toggle { position: absolute; top: calc(100% + 9px); right: 0; display: flex; align-items: center;
  gap: 8px; min-height: 40px; padding: 9px 11px; white-space: nowrap; font-size: 11px; color: #c0c9caba;
  background: #07121b87; border: 1px solid #b6c9d125; border-radius: 3px; backdrop-filter: blur(16px); }
  /* no hover colour */
.world-trace-toggle small { margin-left: 2px; font-size: 8px; color: #8298a4; }
.world-trace-toggle.active { color: #e4bb8d; border-color: #e4bb8d55; }
.world-trace-toggle.active small { color: #e4bb8d; }
.world-trace-toggle:disabled { opacity: .4; cursor: default; }
.is-walking .world-trace-toggle { top: calc(100% + 63px); }

/* ---------- guidance ---------- */
.world-guidance { position: absolute; left: 50%; bottom: 133px; transform: translateX(-50%); z-index: 3;
  display: flex; justify-content: center; align-items: center; gap: 9px; max-width: calc(100% - 48px);
  white-space: nowrap; pointer-events: none; color: #c2cece9e; font-size: 7px; letter-spacing: 1.2px;
  text-shadow: 0 1px 10px #07101c; }
.world-guidance svg { color: #d5b591ae; }          /* compass 12px */

/* ---------- footer: credit + dock ---------- */
.world-interface { position: absolute; left: 30px; right: 24px; bottom: 25px; z-index: 4; display: flex;
  justify-content: space-between; align-items: flex-end; gap: 32px; pointer-events: none; }
.world-credit { pointer-events: auto; min-width: 0; }
.world-credit-label { display: block; margin-bottom: 8px; font-size: 6px; letter-spacing: 2px; color: #9aadb5b3; }
.world-credit h1 { margin: 0; font: 600 23px/1.1 "Barlow Condensed", sans-serif; letter-spacing: .6px;
  color: #e0e6e4; text-shadow: 0 1px 12px #08111b; }
.world-credit h1 button { display: flex; align-items: center; gap: 12px; padding: 0; text-align: left;
  font: inherit; letter-spacing: inherit; }       /* hover: base -> #e2b183 */
.world-credit h1 svg { color: #dab487; }           /* arrow-up-right 16 */
.world-credit p { margin-top: 7px; font-size: 8px; line-height: 1.8; letter-spacing: .6px; color: #b2c1c8b0; }
.world-credit > a { display: inline-flex; align-items: center; gap: 6px; font-size: 7px; line-height: 1.8;
  letter-spacing: .2px; color: #9cabb796; }
.world-credit > a:hover { color: #e2b183; }
.world-dock { display: flex; align-items: stretch; padding: 5px; pointer-events: auto;
  background: linear-gradient(135deg, #18232dd6, #08131dde); border: 1px solid #becbd032; border-radius: 5px;
  backdrop-filter: blur(20px); box-shadow: 0 12px 45px #03080e3d, inset 0 1px #d2ded308; }
.world-dock > button { position: relative; display: flex; align-items: center; gap: 10px; min-height: 52px;
  padding: 11px 17px; border-radius: 2px; white-space: nowrap; font-size: 11px; letter-spacing: .25px;
  color: #b7c3c9; }
.world-dock > button + button { border-left: 1px solid #bacbd21c; }
.world-dock > button > span { display: flex; align-items: baseline; gap: 7px; }
.world-dock small { font-size: 7px; font-weight: 400; color: #8298a4; }
.world-dock > button:hover, .world-dock > button.active, .world-dock > button.discoveries-complete {
  color: #e5bd91; background: #e4bb8d08; }
.world-dock > button.active::after { content: ""; position: absolute; left: 17px; right: 17px; bottom: 5px;
  height: 1px; background: #e5bd9170; }
.world-dock button:disabled { opacity: .4; cursor: default; }

/* ---------- toast & blackout ---------- */
.toast { position: absolute; left: 50%; bottom: 153px; transform: translateX(-50%); z-index: 20;
  display: flex; align-items: center; gap: 12px; max-width: min(90%, 650px); pointer-events: none;
  text-align: left; color: var(--mint); font-size: 10px; line-height: 1.6; }
.toast:not(:empty) { padding: 15px 20px; background: #102322f5; border: 1px solid #9cbaa344;
  box-shadow: 0 10px 40px #0006; animation: reveal .25s; }
.toast svg { flex-shrink: 0; }                     /* radio 16 */
.blackout-message { position: absolute; inset: 0; z-index: 6; display: flex; flex-direction: column;
  justify-content: center; align-items: center; gap: 20px; pointer-events: none; background: #060b11b5; }
.blackout-message > span { padding: 0 24px; text-align: center; font-family: var(--display); font-weight: 600;
  font-size: clamp(25px, 5vw, 65px); letter-spacing: 3px; color: var(--ember); }
.blackout-message small { font-size: 7px; letter-spacing: 2px; color: var(--muted); }

/* ---------- inspector ---------- */
.district-inspector { position: absolute; right: 24px; bottom: 120px; z-index: 4; width: 320px;
  max-height: min(580px, 100dvh - 215px); overflow: auto; padding: 27px; background: #0d1824eb;
  border: 1px solid #c2d4dd30; backdrop-filter: blur(20px); box-shadow: 0 15px 80px #0008;
  animation: reveal .25s; }
.inspector-close { position: absolute; top: 8px; right: 8px; }
.icon-button { display: grid; place-items: center; width: 34px; height: 34px; color: var(--muted);
  border: 1px solid transparent; }               /* no hover colour */
.icon-button:hover { border-color: var(--line); background: #95b9a010; }
.eyebrow { display: block; font-size: 8px; line-height: 1.7; letter-spacing: 2px; color: var(--muted); }
.district-inspector .eyebrow { color: var(--mint); }
.district-inspector h2 { margin: 14px 0 9px; font-family: var(--display); font-size: 29px; line-height: 1.3;
  letter-spacing: 1px; text-transform: uppercase; overflow-wrap: anywhere; }
.district-inspector p { font-size: 11px; line-height: 1.7; color: var(--muted); }
.district-address { display: block; margin-top: 8px; font-size: 9px; color: var(--dim); }
.project-capabilities { margin: 15px 0 0; padding: 0; list-style: none; }
.project-capabilities li { padding: 8px 0; border-top: 1px solid var(--line); font-size: 9px;
  line-height: 1.85; color: var(--muted); }
.visit-button { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-top: 23px;
  padding: 14px 0 0; border-top: 1px solid var(--line); font-size: 9px; letter-spacing: 1.1px;
  color: var(--ember); }                          /* no hover colour */

/* ---------- panels (dialog) ---------- */
.panel { width: 690px; max-width: min(690px, 100vw - 36px); max-height: min(86dvh, 830px); padding: 0;
  overflow: auto; color: var(--ink); background: #0d1823f5; border: 1px solid #bfd2d437; border-radius: 3px;
  box-shadow: 0 35px 130px #0009; }
.panel[open] { animation: reveal .24s; }
.panel::backdrop { background: #020a12aa; backdrop-filter: blur(13px); }
.panel-content { padding: 32px; }
.panel-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
  margin-bottom: 24px; }
.panel-heading h2 { margin-top: 9px; font-family: var(--display); font-size: 34px; line-height: 1.25;
  letter-spacing: .2px; font-weight: 400 /* renders 600 */; }
.panel-heading .icon-button { flex-shrink: 0; margin: -5px -8px 0 0; }
.panel-description { max-width: 95%; margin-bottom: 22px; font-size: 11px; line-height: 1.9; color: var(--muted); }

/* projects */
.filter-tabs { display: flex; gap: 7px; margin: 8px 0 20px; }
.filter-tabs button { padding: 8px 12px; border: 1px solid var(--line); color: var(--muted); font-size: 9px;
  letter-spacing: .8px; text-transform: uppercase; }      /* no hover colour */
.filter-tabs button.active { color: var(--ember); background: #f4ad8208; border-color: #f4ad8277; }
.district-list { border-top: 1px solid var(--line); }
.district-row { display: flex; align-items: center; gap: 13px; width: 100%; padding: 18px 0; text-align: left;
  border-bottom: 1px solid var(--line); }               /* hover: base -> title text turns ember */
.district-row:hover { background: #b3d5b008; }
.district-number { font-size: 9px; color: var(--dim); }
.district-swatch { flex-shrink: 0; width: 8px; height: 14px; box-shadow: 2px 2px #d5ecd821; }
.district-row-title { display: flex; flex-direction: column; flex: 1; gap: 5px; min-width: 0; }
.district-row strong { font-size: 12px; font-weight: 400; overflow-wrap: anywhere; }
.district-row small { font-size: 9px; line-height: 1.5; color: var(--muted); }
.district-type { padding: 4px 6px; border: 1px solid var(--line); font-size: 7px; color: var(--muted); }
.district-type.live { color: #c3d4c6; border-color: #a5d8bd33; }
.district-row > svg { color: var(--dim); }
.data-note { margin-top: 20px; font-size: 8px; line-height: 1.7; color: var(--dim); }

/* discoveries */
.signal-grid { border-top: 1px solid var(--line); }
.signal { border-bottom: 1px solid var(--line); }
.signal summary { display: flex; align-items: center; gap: 16px; padding: 18px 0; list-style: none;
  cursor: pointer; color: var(--dim); }
.signal summary::-webkit-details-marker { display: none; }
.signal summary > span { font-size: 10px; }
.signal strong { flex: 1; font-size: 11px; font-weight: 400; }
.signal.found summary { color: #d1b58f; }
.signal p { padding: 0 15px 20px 45px; font-size: 10px; line-height: 1.9; color: var(--muted); }
.signal[open] summary > svg:last-child { transform: rotate(90deg); }      /* instant, no transition */
.wide-link { display: flex; justify-content: space-between; gap: 12px; width: 100%; margin-top: 25px;
  padding: 15px; text-align: left; border: 1px solid var(--line); color: var(--ember); font-size: 11px; }

/* builder */
.builder-heading { display: flex; align-items: center; gap: 22px; padding-bottom: 25px;
  border-bottom: 1px solid var(--line); }
.builder-mark { position: relative; display: grid; place-content: center; flex-shrink: 0; width: 85px; height: 85px;
  font-family: var(--display); font-size: 30px; letter-spacing: 1px; color: var(--ember);
  background: #f4ad8209; border: 1px solid #f4ad8244; }
.builder-mark > span { position: absolute; top: 0; right: 5px; font-size: 14px; }
.builder-heading h3 { font-size: 19px; font-weight: 400; line-height: 1.4; letter-spacing: -.8px; }
.builder-heading p { margin-top: 8px; font-size: 8px; line-height: 1.7; color: var(--ember); }
.builder-bio { margin: 25px 0; font-size: 12px; line-height: 1.95; color: #b2bcae; }
.builder-bio strong, .author-facts strong { color: var(--ink); font-weight: 500; }
.contact-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
.contact-links a { display: flex; align-items: center; gap: 10px; padding: 12px 15px;
  border: 1px solid #f4ad8255; font-size: 11px; color: var(--ember); }
.author-facts > div { display: grid; grid-template-columns: 118px 1fr; column-gap: 12px; padding: 19px 0;
  border-top: 1px solid var(--line); }
.author-facts > div > span { font-size: 8px; line-height: 2.2; letter-spacing: 1px; color: var(--ember); }
.author-facts p { font-size: 10px; line-height: 1.85; color: var(--muted); }
.author-facts a { grid-column: 2; display: inline-flex; align-items: center; gap: 5px; margin-top: 9px;
  font-size: 9px; line-height: 1.5; color: var(--ember); }
.author-facts p a { font-size: inherit; margin-top: 0; }
.world-maintenance { display: flex; align-items: center; gap: 8px; margin-top: 25px; padding: 10px 0 0;
  font-size: 7px; letter-spacing: 1px; color: #71848a; }
.world-maintenance:hover { color: #e2b183; }

/* help */
.help-list p { display: flex; align-items: flex-start; gap: 15px; padding: 14px 0;
  border-bottom: 1px solid var(--line); font-size: 11px; line-height: 1.8; color: var(--muted); }
.help-list svg { flex-shrink: 0; width: 16px; height: 16px; margin-top: 3px; color: var(--ember); }
.help-list kbd { display: inline; }                    /* still blockified: it is a flex item */
.world-help-actions { display: grid; margin-top: 22px; border: 1px solid #b4c7cf28; }
.world-help-actions > button { display: flex; align-items: center; gap: 11px; padding: 13px 15px;
  text-align: left; font-size: 10px; color: #c8d1d2; }
.world-help-actions > button + button { border-top: 1px solid #b4c7cf20; }
.world-help-actions > button > svg:first-child { color: #dfb98c; }
.world-help-actions > button > svg:last-child,
.world-help-actions > button > span:last-child { margin-left: auto; color: #dfb98c; }
.world-help-actions > button > span:last-child { font-size: 8px; }
.world-help-actions > button:hover { color: #e2b183; background: #e2b18308; }

/* ---------- keyframes ---------- */
@keyframes reveal { from { opacity: 0; translate: 0 7px; } to { opacity: 1; translate: 0; } }
@keyframes blink  { 0%, 65% { opacity: 1; } 66%, to { opacity: 0; } }
```

**Walk-mode CSS.** This is authored unlayered, so it is final as written apart from formatting:

```css
.walking-controls { position: absolute; inset: 0; z-index: 5; pointer-events: none; color: #d4dedf;
  font-family: "IBM Plex Mono", monospace; }
.walking-controls button { pointer-events: auto; touch-action: none; user-select: none; }
.walk-identity { position: absolute; top: 28px; left: 26px; display: flex; align-items: center; gap: 12px;
  font-size: 13px; letter-spacing: 1px; text-shadow: 0 2px 12px #06101b; }
.walk-identity small { display: block; margin-top: 5px; font-size: 9px; letter-spacing: 2px; color: #a8b7bd; }
.walk-view-label { padding-left: 12px; border-left: 1px solid #adc7ce38; font-size: 9px; color: #a9c1bb; }
.walk-toolbar { position: absolute; top: 78px; left: 24px; display: flex; gap: 7px; }
.walk-toolbar button { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 9px 12px;
  font-size: 11px; background: #0a1822d9; border: 1px solid #b7c9d233; border-radius: 4px;
  backdrop-filter: blur(12px); }
.walk-toolbar button:hover { color: #edc391; border-color: #e6bf8c7a; }
.walk-toolbar button:disabled { color: #a6b5b8; opacity: .72; cursor: default; }
.walk-toolbar .walk-lift span { max-width: 150px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.walk-toolbar kbd, .walk-desktop-hints kbd { padding: 3px 5px; font-size: 10px; background: #c6d7d511;
  border: 1px solid #b9cac435; border-radius: 3px; }
.walk-desktop-hints { position: absolute; left: 50%; bottom: 35px; transform: translateX(-50%); display: flex;
  align-items: center; gap: 21px; white-space: nowrap; font-size: 10px; text-shadow: 0 1px 8px #04101a; }
.walk-desktop-hints > span { display: flex; align-items: center; gap: 7px; }
.walk-reticle { position: absolute; top: 50%; left: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%;
  background: #d9ece0bd; box-shadow: 0 0 2px 2px #04101855; }
.walk-stick, .walk-touch-actions, .walk-touch-hint,
.is-walking .world-interface, .is-walking .world-location, .is-walking .world-guidance { display: none; }

@media (pointer: coarse), (max-width: 800px) {
  .walk-identity { top: 22px; left: 18px; gap: 8px; font-size: 11px; }
  .walk-identity small { font-size: 8px; }
  .walk-view-label, .walk-desktop-hints, .walk-toolbar kbd { display: none; }
  .walk-toolbar { top: 77px; left: 15px; right: 15px; flex-wrap: wrap; gap: 6px; }
  .walk-toolbar button { min-height: 44px; padding: 9px; font-size: 10px; }
  .walk-toolbar .walk-lift { max-width: min(230px, 100vw - 160px); }
  .walk-stick { position: absolute; left: max(24px, env(safe-area-inset-left));
    bottom: max(42px, env(safe-area-inset-bottom)); display: grid; place-items: center; width: 126px; height: 126px;
    border-radius: 50%; background: radial-gradient(#c7dddb0c, #0c1a24a6); border: 1px solid #c1d5da47;
    backdrop-filter: blur(6px); }
  .stick-ring { position: absolute; inset: 21px; border: 1px dashed #c8d4cb29; border-radius: 50%; }
  .stick-knob { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 50%; color: #e1c198;
    background: linear-gradient(135deg, #41525ccf, #142632df); border: 1px solid #c1d4d56b;
    box-shadow: 0 3px 16px #03080e80; }          /* inline transform: translate(x*36px, -y*36px) */
  .stick-caption { position: absolute; left: 0; bottom: -22px; width: 100%; text-align: center; font-size: 10px;
    letter-spacing: 2px; color: #b7c9cbb3; }
  .walk-touch-actions { position: absolute; right: max(24px, env(safe-area-inset-right));
    bottom: max(56px, env(safe-area-inset-bottom)); display: flex; align-items: flex-end; gap: 11px; }
  .walk-touch-actions button { display: flex; flex-direction: column; justify-content: center; align-items: center;
    gap: 5px; width: 59px; height: 59px; border-radius: 50%; font-size: 9px; color: #c8d7d7; background: #0c1a25c9;
    border: 1px solid #bdcfd34d; backdrop-filter: blur(6px); }
  .walk-touch-actions .walk-jump { width: 75px; height: 75px; color: #ecd0a4; border-color: #d9ba8261; }
  .walk-touch-actions .is-running { color: #e4bf85; background: #3c3529cc; }
  .walk-touch-actions .walk-inspect { position: absolute; right: 12px; bottom: 88px; width: 52px; height: 52px;
    font-size: 8px; }
  .walk-touch-hint { position: absolute; right: 24px; bottom: 212px; display: block; max-width: 140px;
    text-align: right; font-size: 9px; line-height: 1.7; letter-spacing: 1px; color: #c9dbd48c; }
}
@media (max-height: 520px) {
  .walk-stick { width: 106px; height: 106px; bottom: 30px; }
  .walk-touch-actions { bottom: 35px; } .walk-touch-hint { bottom: 130px; }
  .walk-identity { top: 17px; } .walk-toolbar { top: 64px; }
}
@media (max-width: 360px) {
  .walk-identity { top: 16px; left: 12px; } .walk-toolbar { top: 65px; left: 10px; }
  .walk-toolbar button { justify-content: center; width: 44px; padding: 8px; }
  .walk-toolbar button span { display: none; }
  .walk-toolbar .walk-lift { justify-content: flex-start; width: min(124px, 100vw - 194px); }
  .walk-toolbar .walk-lift span { display: block; max-width: calc(100% - 25px); }
  .walk-stick { left: max(12px, env(safe-area-inset-left)); bottom: max(32px, env(safe-area-inset-bottom));
    width: 104px; height: 104px; }
  .stick-ring { inset: 17px; } .stick-knob { width: 46px; height: 46px; } .stick-caption { bottom: -18px; }
  .walk-touch-actions { right: max(12px, env(safe-area-inset-right)); bottom: max(38px, env(safe-area-inset-bottom)); gap: 8px; }
  .walk-touch-actions button { width: 52px; height: 52px; }
  .walk-touch-actions .walk-jump { width: 64px; height: 64px; }
  .walk-touch-actions .walk-inspect { width: 48px; height: 48px; bottom: 76px; right: 6px; }
  .walk-touch-hint { max-width: 120px; font-size: 8px; bottom: 174px; right: 12px; }
}
```

### 4.4 Breakpoints and mobile differences (effective)

```css
@media (max-width: 1100px) {
  .world-credit h1 { font-size: 20px; }
  .world-dock > button { gap: 8px; padding: 10px 13px; font-size: 11px; }
  .world-dock small { font-size: 6px; }
}
@media (max-width: 900px) {                      /* surviving layered rules only */
  .toast { min-width: 250px; max-width: 88%; font-size: 9px; }
  .panel-content { padding: 25px; }
}
@media (max-width: 800px) {
  .world-vignette { background: linear-gradient(#0000 63%, #06111b75 87%, #050d17f2),
                                linear-gradient(#06101b55, #0000 16%); }
  .world-interface { left: 18px; right: 18px; bottom: max(15px, env(safe-area-inset-bottom));
    flex-direction: column; align-items: center; gap: 17px; }
  .world-credit { align-self: flex-start; }
  .world-credit-label { margin-bottom: 5px; font-size: 5px; letter-spacing: 1.5px; }
  .world-credit h1 { font-size: 21px; letter-spacing: .5px; }
  .world-credit p { margin-top: 4px; font-size: 7px; }
  .world-credit > a { font-size: 6px; }
  .world-dock { width: 100%; max-width: 520px; justify-content: space-between; padding: 4px; }
  .world-dock > button { flex: 1; flex-direction: column; justify-content: center; gap: 6px; min-height: 60px;
    padding: 9px 5px; font-size: 11px; }
  .world-dock > button > svg { width: 17px; height: 17px; }
  .world-dock > button > span { gap: 5px; }
  .world-dock small { display: none; }
  .world-dock > button.active::after { left: 24%; right: 24%; bottom: 3px; }
  .world-location { top: 25px; left: 20px; gap: 7px; font-size: 6px; letter-spacing: 1px; }
  .world-sector { display: none; }
  .world-utilities { top: 13px; right: 15px; gap: 0; padding: 3px; }
  .world-utility { width: 40px; height: 40px; } .world-utility svg { width: 15px; height: 15px; }
  .world-utility-divider { margin: 0 2px; }
  .world-trace-toggle { padding: 7px 10px; font-size: 11px; }
  .world-guidance { bottom: 198px; max-width: calc(100% - 36px); font-size: 6px; letter-spacing: .6px; }
  .district-inspector { right: 18px; bottom: 192px; width: min(310px, 100vw - 36px);
    max-height: calc(100dvh - 280px); padding: 24px; }
  .district-inspector h2 { font-size: 25px; }
  .toast { bottom: 210px; font-size: 9px; }
  .panel { max-height: 88dvh; } .panel-heading h2 { font-size: 29px; }
}
@media (max-width: 600px) {
  .world-location { display: none; }
  .icon-button { width: 32px; height: 36px; }
  .panel { max-width: calc(100vw - 24px); }
  .panel-content { padding: 23px 18px; }
  .panel-description { font-size: 10px; }
  .filter-tabs button { padding: 8px 10px; font-size: 8px; }
  .district-row { gap: 9px; padding: 16px 0; } .district-row strong { font-size: 11px; }
  .district-row small { font-size: 8px; } .district-type { font-size: 6px; } .district-number { font-size: 8px; }
  .builder-heading { gap: 15px; } .builder-mark { width: 60px; height: 68px; font-size: 25px; }
  .builder-heading h3 { font-size: 15px; } .builder-heading p { font-size: 7px; } .builder-bio { font-size: 11px; }
  .author-facts > div { grid-template-columns: 1fr; gap: 10px; } .author-facts a { grid-column: 1; }
  .contact-links a { font-size: 10px; }
  .help-list p { font-size: 10px; }
}
@media (max-width: 390px) {
  .world-credit h1 { font-size: 18px; } .world-credit h1 button { gap: 7px; }
  .world-credit h1 svg { width: 13px; height: 13px; }
  .world-dock > button > span { gap: 3px; }
}
@media (max-height: 560px) and (min-width: 650px) {            /* landscape phone */
  .world-interface { flex-direction: row; align-items: flex-end; gap: 20px; bottom: 15px; }
  .world-credit h1 { font-size: 17px; } .world-credit > a { font-size: 6px; }
  .world-dock { width: auto; }
  .world-dock > button { flex-direction: row; min-height: 42px; padding: 8px 11px; }
  .world-dock small { display: none; }
  .world-guidance { bottom: 105px; }
  .district-inspector { max-height: calc(100dvh - 160px); bottom: 100px; }
}
@media (prefers-reduced-motion: reduce) {
  *, :before, :after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
}
```

Observed computed values: at 390×844 the panel is 366px wide, the inspector 310px at `bottom:192px` with a 25px h2, and the dock 354×70. At 844×390 the credit h1 is 17px and the dock 475×54. The mobile walk toolbar wraps onto two rows: 1st person, Lift and the map icon, then Exit walk (`64-mob-walk.png`).

### 4.5 Borders, radii, blur, shadows, motion (summary)

| Aspect | Values |
|---|---|
| Hairlines | Always 1px. Common colour `var(--line)` = `#b5c4cf28`. |
| Radii | Mostly square. Utilities 4, utility buttons 2, trace toggle 3, dock 5, dock buttons 2, panel 3, walk buttons 4, kbd 2 (walk kbd 3), round 50% for stick, knob, touch buttons and reticle. Inspector, toast, rows, tabs, badges, cards and contact links have **no radius**. |
| Backdrop blur | Utilities and trace toggle 16; dock 20; inspector 20; panel backdrop 13; walk toolbar 12; touch controls 6. |
| Shadows | Dock `0 12px 45px #03080e3d, inset 0 1px #d2ded308`; inspector `0 15px 80px #0008`; panel `0 35px 130px #0009`; toast `0 10px 40px #0006`; knob `0 3px 16px #03080e80`; swatch `2px 2px #d5ecd821` (hard, no blur). Text shadows on location, guidance, credit h1 and walk text. |
| Motion | `reveal` (opacity 0 → 1, `translate:0 7px` → 0) at .25s on toast and inspector, .24s on panel open. Stage fade 1.5s. Blackout fade 1.2s. Boot block blinks at .6s. Buttons transition colour, background and transform over .18s and press 1px down on `:active`. The details chevron rotates instantly. There are no route transitions and no other JS-driven UI animation. |

---

## 5. Assets used by the UI (paths relative to `site/`)

### 5.1 Fonts

`assets/*.woff2` / `*.woff`, as listed in 4.1. Actually downloaded at runtime: `ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2`, `ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2` and `barlow-condensed-latin-600-normal-DepVgxBB.woff2`. The `.woff` fallbacks and Silkscreen are never fetched in Chromium.

### 5.2 Icons

Icons are **lucide-react 1.41.0**, rendered inline. They are not files. Each is `<svg class="lucide lucide-<name>" width=N height=N viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`, coloured by `currentColor`.

| Icon | Where (size px) |
|---|---|
| `compass` | Orbit dock 18; default guidance 12; help row 16; `Start cinematic tour` 16; `Back to exploring` 17 |
| `footprints` | Walk dock 18; joystick knob 20 |
| `map` | Projects dock 18; walk toolbar 17; help row 16; street-level action 16 |
| `radio` | Discoveries dock 18; toast 16; help row 16 |
| `circle-question-mark` | Help dock 18 |
| `sun` | day button 17; **Ray Tracing toggle 13** |
| `moon` | night button 17 |
| `pause` / `play` | motion button 16; `pause` also a help row 16 |
| `volume-x` / `volume-2` | sound 17 |
| `copy` / `check` | share 16; `check` also marks found signals 17 |
| `x` | panel close 20; inspector close 16 |
| `arrow-up-right` | credit name 16; credit link 10; district rows 16; visit button 17; Telegram 12; fact links 12; help actions 14 |
| `git-fork` | `FOLLOW THE WORK` 17 |
| `send` | Telegram 14 |
| `phone` | phone 14 |
| `arrow-down` | maintenance 11; help row 16 |
| `audio-lines` | help row 16 |
| `grid-2x2` | Pixel vision 16 |
| `move-up-right` | free-flight link 17 |
| `scan-line` | unknown signal 17; INSPECT 21 |
| `chevron-right` | signal summary 14, rotated 90° when open |
| `camera` | view toggle 17 |
| `arrow-up-down` | lift 17 |
| `log-out` | Exit walk 17 |
| `person-standing` | run/walk 23 |
| `arrow-up` | jump 27 |

Help-list icons have no size prop (24 by default) and are forced to 16px by CSS.

### 5.3 Images

| File | Size | Use |
|---|---|---|
| `favicon.svg` | 32×32 | Rounded square `#0b1015` (rx 6) with an orange `#ff986b` "E"-like pixel glyph: `<path d="M8 7h17v5H13v2h9v4h-9v2h12v5H8z"/>`. |
| `city-cinematic.webp` | 1440×810 | **Postcard fallback image** at `/eukalpia/city-cinematic.webp`. |
| `og.png` | 1200×630 | Social preview in meta tags only. |
| `profile-ascii.svg` (“DIDN'T EXPECT THIS?” ASCII art) and `profile-cover.svg` (90-frame city animation) | – | **Not referenced by the site.** These are GitHub-profile README assets. |

### 5.4 3D assets behind UI features

| Path | Feature |
|---|---|
| `models/ur01/character.glb` (151k tris, 17.8 MB) | Walk-mode character (desktop) |
| `models/ur01/character-mobile.glb` (44.7k tris, 6.7 MB) | Walk-mode character (small screens) |
| `models/ur01/manifest.json` | Character metadata (height 1.824 m, 26 bones). Not fetched at runtime. |
| `models/factory-kit/factory.gltf` + `.bin` + `textures/modular_factory_facade_*_1k.jpg` | Building facades |
| `materials/{concrete,steel}-{diff,arm,normal}.jpg`, `materials/rock-{color,arm,normal}.jpg` | PBR materials |
| `materials/sky-light.hdr` | Environment and background sky |

### 5.5 Code chunks

| Chunk | Contents |
|---|---|
| `assets/index-FeWZcjVo.js` | Entry |
| `Experiment-BQiryQKt.js` | UI, content and state |
| `City-BFhRCai-.js` | Canvas wrapper, trace status, postcard |
| `create-city-TJ6JcRCg.js` | Scene, input, signs, lift, tour |
| `character-BSoN78fY.js` | UR-01 rig and IK |
| `ray-tracing-DdhOlKKH.js` + `pathtracer-D97F1KlO.js` + `*MeshBVH.worker-*.js` | Photo mode |
| `three-*.js`, `three-addons-*.js`, `vendor-*.js` | Libraries: React 19.2.8, lucide |
| `vendor-jyMoNgwb.css` | `@font-face` rules |
| `Experiment-DGYta9Gz.css` | All UI styles |

---

## 6. Ambiguities, quirks and things not determined

### 6.1 Not exercised end-to-end

These are documented from code only:

- **The LMS lift ride.** Walking 35 m under SwiftShader was too slow.
- **The "unmarked elevator" click.** Its hit-box sits inside the monolith hit-box, so it never won the raycast from orbit; it may be pickable from walk with F at close range.
- **These toasts:** audio failure, clipboard failure, character-load failure and tracing failure.
- **The `Preparing ray tracing…` / `Loading ray tracer · you can cancel at any time` statuses.** They are transient and were already replaced by `Preparing geometry · 0%` on the first poll.
- **Sound.** Enabling worked (no toast, icon and label switched), but the audio could not be heard headless.

### 6.2 Environment-dependent

- **The data-note date** (`04 Sept 2026` in UTC) depends on the viewer's time zone (05 Sept in UTC+5) and on ICU's `en-GB` short month (`Sept` vs `Sep`). Hard-code the string in v2 if 1:1 output matters.
- **Scene screenshots** are SwiftShader renders, slow and possibly slightly different in lighting from a GPU. DOM and CSS values are exact.
- **Small-screen quality profile** (`max-width:900px`) and reduced motion are both read **once at load**, not on resize or preference change.

### 6.3 v1 quirks a 1:1 port must either copy or consciously fix

1. Help row 2 renders as ragged flex columns, because `<kbd>`s and text runs are flex items (`18-help.png`).
2. The postcard caption is hidden behind the dock and vignette on desktop.
3. Toast timers are never cleared, so a previous message's 5.5 s timer can wipe a newer toast early.
4. The free-flight toast appears even when switching flight **off**.
5. The ray-trace status says `1 samples` (no singular).
6. From underworld, E goes to overview while the Help action goes to street.
7. Under reduced motion the scene clock never runs, even after "Resume motion".
8. The underworld toast from `?sector=-1` fires at mount, during boot, and can expire before the city appears.
9. The inspector `<aside>` receives programmatic focus and shows the browser's default focus ring on touch/keyboard (`62-mob-inspector.png`), because there is no custom `aside:focus` style.
10. Pixel vision is soft and blurry rather than crisp.
11. The night/day state class is `night`/`dawn`, and `dawn` has no styling.
12. The canvas is `role="img"` yet focusable and interactive.
13. Hover colour does not change on several controls (4.0).
14. Panel h2, inspector h2 and the builder mark request weight 400 but render with the only shipped Barlow face (600).
15. Konami `b`/`a` are case-sensitive.
16. Re-selecting a district from Projects while walking ends walk.
17. The hover label sticks when the pointer leaves the canvas onto UI.
18. The `walk + Ray Tracing` combination keeps the third-person character in the traced frame. This is intentional in code.

### 6.4 Dead code and styles (do not port unless wanted)

- **Unused data:** `active` per district, `recentPushes: 94`, and the tour waypoint names (2.4).
- **Removed elements with leftover CSS:** the earlier landing page and a terminal UI. Their CSS remains in `Experiment-DGYta9Gz.css` but no element uses it: `.topbar`, `.brand*`, `.pixel-mark`, `.top-center`, `.separator`, `.top-actions`, `.sound-button`, `.github-link`, `.intro*`, `.short-rule`, `.tagline`, `.title-dot`, `.blinking-cursor`, `.invitation`, `.enter-button`, `.world-count`, `.mini-cross`, `.atmosphere`, `.eclipse`, `.horizon`, `.grain`, `.scene-coordinate`, `.scene-tools`, `.tool-separator`, `.scene-hint`, `.author-intro`, `.author-name`, `.text-link`, `.production-peek`, `.peek-*`, `.bottom-bar`, `.bottom-nav`, `.bottom-right`, `.local-time`, `.terminal-panel`, `.terminal-log`, `.command-line`, `.terminal-input`, `.terminal-footnote`, `.cinematic-backdrop`, `.cinematic-shade`, `.cinematic-mist`, `.cinematic-embers`, `.is-cinematic …`, and the `:has([aria-label="Resume motion"])` animation-pause rules.
- **Dead keyframes:** `slow-approach`, `mist-drift`, `ember-drift`.
- **The bare `h1` display styles** (Silkscreen / Barlow 94–190px). Only `.world-credit h1` renders.
- **The `.directory-panel` class** has no rules.

### 6.5 Spec mismatch

The v2 spec (§9) says the name should become `UMARALIEV RAVSHAN RUSTAMJON O'GLI`. v1 shows `UGLI` / `Ugli` in:

- the credit h1 and its aria-label;
- the builder h3;
- `<meta name="description">` (`Umaraliev Ravshan Rustamjon Ugli`);
- `<noscript>`.

`og:description` uses `Ravshan Umaraliev`.

The spec also lists a "save frame" button for photo mode, which v1 does not have.

---

## Appendix: screenshot index (`v1ui/`)

| File | State |
|---|---|
| `00-boot.png` | boot (`ASSEMBLING THE WORLD...`), Walk disabled |
| `01-orbit-desktop.png` | orbit just after ready (sky only, assets still streaming) |
| `scan-day.png`, `40-toast-cat.png` | orbit, reduced motion (paused, Resume icon), hover label on the cat |
| `80-normal-motion-tour.png` | normal motion, cinematic tour |
| `01b-orbit-motion-earlier-run.png` | normal motion, tour, with signs visible (earlier run of the same build) |
| `10-hover-district.png` | guidance shows `● University LMS` |
| `11-projects-all.png`, `12-projects-production.png`, `12-projects-public-repositories.png`, `13-projects-bottom.png` | Projects panel and filters, data note |
| `14-inspector-edu-ai.png`, `15b-inspector-lab.png`, `15-inspector-public-repo.png` | inspector variants |
| `16-discoveries-0.png`, `17-discoveries-open-hints.png`, `30-discoveries-complete.png`, `47-discoveries-complete.png` | Discoveries 0/6, hints open, 2/6, 6/6 |
| `18-help.png` | Help panel |
| `19-author-top.png`, `20-author-mid.png`, `21-author-bottom.png` | Builder panel |
| `22-share-copied.png` | share → check icon |
| `23-sound-on.png` | sound active |
| `24-night.png`, `45-ghost-hover.png` | night, ghost window hover |
| `43-blackout.png` | seven-knocks blackout + toast (with override colours) |
| `27-override.png` | override palette in the scene (and an inspector) |
| `29-underworld-all-found.png`, `46-underworld-complete.png` | underworld sector |
| `81-all-signals-toast.png` | `ALL SIGNALS FOUND` toast |
| `41-cat-moving.png`, `42-toast-cipher.png`, `44-after-blackout.png`, `48-street-sector-completed.png` | cat after discovery, cipher toast, scene after the blackout ends, street sector with 6/6 |
| `31-pixel-vision.png` | pixel vision |
| `32-free-flight.png` | free flight |
| `50-walk-desktop.png`, `51-walk-first-person.png` | walk mode desktop |
| `53-ray-tracing.png` | photo mode, `Refining light · 3 samples · drag to reframe` |
| `53b-ray-tracing-earlier-run.png` | photo mode after about 5 s (earlier run) |
| `60…65-mob-*.png` | 390×844 touch: orbit, projects, inspector, builder, walk, joystick drag |
| `60…65-land-*.png` | 844×390 landscape |
| `70-postcard-fallback.png`, `71-postcard-fallback-mobile.png` | postcard mode (WebGL disabled) |
| `82-1024-underworld.png` | 1024px breakpoint |

Raw measurements: `sessionB.json` (desktop styles, panels, share, sound), `sessionC.json` (discoveries), `sessionD.json` / `sessionD2.json` (walk, trace), `sessionE-mob.json` / `sessionE-land.json` (mobile), `sessionF.json` (postcard), `sessionG.json` (final toast, sanitising), `sessionH.json` (hover states), `scan-day.json` (screen positions of pickables). Scripts are in `v1ui/scripts/`. Formatted CSS is in `v1ui/css/`.
