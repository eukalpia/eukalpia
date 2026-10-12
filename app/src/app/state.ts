import type { Sector } from './url';

export type PanelId = 'districts' | 'signals' | 'author' | 'help';

/** The interface's state (inventory 3.1). In v2 street level is walking with UR-01. */
export interface UiState {
  sector: Sector;
  panel: PanelId | null;
  /** The district shown in the inspector. */
  selected: number | null;
  tour: boolean;
  fly: boolean;
  paused: boolean;
  tracing: boolean;
  walking: boolean;
  pixelated: boolean;
  night: boolean;
  sound: boolean;
  /** Counts navigations, so going to the same sector again still moves the camera. */
  navigation: number;
}

export type UiAction =
  | { type: 'go'; sector: Sector }
  | { type: 'select'; id: number | null }
  | { type: 'panel'; panel: PanelId | null }
  | { type: 'walk'; on: boolean }
  | { type: 'trace'; on: boolean }
  | { type: 'startTour' }
  | { type: 'tourEnded' }
  | { type: 'toggleFly' }
  | { type: 'togglePause' }
  | { type: 'togglePixel' }
  | { type: 'toggleNight' }
  | { type: 'toggleSound' };

export function initialUiState(o: { sector: Sector; reducedMotion: boolean; shot: boolean; night?: boolean }): UiState {
  return {
    sector: o.sector,
    panel: null,
    selected: null,
    tour: o.sector === 'overview' && !o.reducedMotion && !o.shot,
    fly: false,
    paused: o.reducedMotion,
    tracing: false,
    walking: false,
    pixelated: false,
    night: o.night ?? false,
    sound: false,
    navigation: 0,
  };
}

/** Walking switches off photo mode, pause, the tour, flight, the selection and panels. */
const startWalking = (s: UiState): UiState => ({
  ...s,
  sector: 'street',
  walking: true,
  tracing: false,
  paused: false,
  tour: false,
  fly: false,
  selected: null,
  panel: null,
});

/** Leaving walk returns to the overview. */
const stopWalking = (s: UiState): UiState =>
  s.walking || s.sector === 'street' ? { ...s, walking: false, sector: 'overview' } : s;

export function uiReducer(s: UiState, a: UiAction): UiState {
  switch (a.type) {
    case 'go': {
      const base = { ...s, navigation: s.navigation + 1, fly: false, tour: false, selected: null, panel: null };
      return a.sector === 'street' ? startWalking(base) : { ...base, sector: a.sector, walking: false };
    }
    case 'select':
      if (a.id === null) return { ...s, selected: null };
      return { ...stopWalking(s), selected: a.id, panel: null, fly: false, tour: false };
    case 'panel':
      return { ...s, panel: a.panel };
    case 'walk':
      return a.on ? startWalking(s) : stopWalking(s);
    case 'trace':
      // UR-01 stays in the traced frame where it walks (v1 kept it too); the world freezes its input.
      return a.on ? { ...s, tracing: true, paused: true, tour: false, fly: false } : { ...s, tracing: false };
    case 'startTour':
      return {
        ...s,
        sector: 'overview',
        walking: false,
        navigation: s.navigation + 1,
        tour: true,
        paused: false,
        tracing: false,
        fly: false,
        selected: null,
        panel: null,
      };
    case 'tourEnded':
      return { ...s, tour: false };
    case 'toggleFly':
      return { ...s, fly: !s.fly, tracing: false, tour: false, panel: null };
    case 'togglePause':
      return s.tracing ? s : { ...s, paused: !s.paused };
    case 'togglePixel':
      return { ...s, pixelated: !s.pixelated };
    case 'toggleNight':
      return { ...s, night: !s.night };
    case 'toggleSound':
      return { ...s, sound: !s.sound };
  }
}
