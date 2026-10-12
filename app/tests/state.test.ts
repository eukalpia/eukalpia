import { initialUiState, uiReducer, type UiAction, type UiState } from '../src/app/state';

const start = (over: Partial<UiState> = {}): UiState => ({
  ...initialUiState({ sector: 'overview', reducedMotion: false, shot: false }),
  ...over,
});
const run = (s: UiState, ...actions: UiAction[]) => actions.reduce(uiReducer, s);

test('the tour starts on its own over the overview, unless motion is reduced or a shot is set', () => {
  expect(initialUiState({ sector: 'overview', reducedMotion: false, shot: false }).tour).toBe(true);
  expect(initialUiState({ sector: 'overview', reducedMotion: true, shot: false })).toMatchObject({
    tour: false,
    paused: true,
  });
  expect(initialUiState({ sector: 'underworld', reducedMotion: false, shot: false }).tour).toBe(false);
  expect(initialUiState({ sector: 'overview', reducedMotion: false, shot: true }).tour).toBe(false);
});

test('going somewhere ends walking, flight, the tour and any selection, and closes panels', () => {
  const s = run(start({ fly: true, selected: 3, panel: 'help' }), { type: 'go', sector: 'underworld' });
  expect(s).toMatchObject({
    sector: 'underworld',
    fly: false,
    tour: false,
    selected: null,
    panel: null,
    walking: false,
  });
  expect(s.navigation).toBe(1);
  // Re-selecting the same sector still counts as a navigation (the camera flies again).
  expect(run(s, { type: 'go', sector: 'underworld' }).navigation).toBe(2);
});

test('street level is walking: going there walks, leaving walk returns to the overview', () => {
  const s = run(start({ tracing: true, paused: true }), { type: 'go', sector: 'street' });
  expect(s).toMatchObject({ sector: 'street', walking: true, tracing: false, paused: false });
  expect(run(s, { type: 'walk', on: false })).toMatchObject({ sector: 'overview', walking: false });
});

test('walking switches off photo mode, pause, tour, flight, selection and panels', () => {
  const s = run(start({ tracing: true, paused: true, fly: true, selected: 2, panel: 'districts' }), {
    type: 'walk',
    on: true,
  });
  expect(s).toMatchObject({
    walking: true,
    sector: 'street',
    tracing: false,
    paused: false,
    tour: false,
    fly: false,
    selected: null,
    panel: null,
  });
});

test('photo mode forces pause and ends tour and flight, but keeps UR-01 where it walks; leaving keeps the pause', () => {
  const on = run(start({ walking: true, sector: 'street', fly: true }), { type: 'trace', on: true });
  expect(on).toMatchObject({ tracing: true, walking: true, sector: 'street', paused: true, tour: false, fly: false });
  expect(run(on, { type: 'togglePause' }).paused).toBe(true);
  expect(run(on, { type: 'trace', on: false })).toMatchObject({ tracing: false, paused: true });
});

test('selecting a district ends walking and the tour and closes the panel; closing the card keeps the camera', () => {
  const s = run(start({ walking: true, sector: 'street', panel: 'districts' }), { type: 'select', id: 7 });
  expect(s).toMatchObject({ selected: 7, walking: false, sector: 'overview', panel: null, tour: false });
  expect(run(s, { type: 'select', id: null }).selected).toBeNull();
});

test('the cinematic tour starts from the overview and unpauses; a drag ends it', () => {
  const s = run(start({ sector: 'underworld', paused: true, tracing: true, panel: 'help', tour: false }), {
    type: 'startTour',
  });
  expect(s).toMatchObject({ sector: 'overview', tour: true, paused: false, tracing: false, panel: null });
  expect(run(s, { type: 'tourEnded' }).tour).toBe(false);
});

test('free flight ends photo mode and the tour and closes the panel', () => {
  const s = run(start({ tracing: true, panel: 'help' }), { type: 'toggleFly' });
  expect(s).toMatchObject({ fly: true, tracing: false, tour: false, panel: null });
  expect(run(s, { type: 'toggleFly' }).fly).toBe(false);
});

test('one panel at a time; toggles flip', () => {
  const s = run(start(), { type: 'panel', panel: 'help' }, { type: 'panel', panel: 'signals' });
  expect(s.panel).toBe('signals');
  expect(run(s, { type: 'toggleNight' }, { type: 'toggleSound' }, { type: 'togglePixel' })).toMatchObject({
    night: true,
    sound: true,
    pixelated: true,
  });
});
