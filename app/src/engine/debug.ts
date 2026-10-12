import type { PickTarget } from '../world/picking';
import type { QualityTier, TimeOfDay } from './world';

export type ShotName =
  | 'orbit-day'
  | 'orbit-night'
  | 'underside'
  | 'skyline'
  | 'street-day'
  | 'street-night'
  | 'street-corner'
  | 'lms-lift'
  | 'lms-roof'
  | 'character-front'
  | 'character-side'
  | 'character-closeup'
  | 'character-three-quarter'
  | 'secret-cat'
  | 'secret-beacon'
  | 'secret-elevator'
  | 'secret-ghost-night';

const SHOT_NAMES: readonly ShotName[] = [
  'orbit-day',
  'orbit-night',
  'underside',
  'skyline',
  'street-day',
  'street-night',
  'street-corner',
  'lms-lift',
  'lms-roof',
  'character-front',
  'character-side',
  'character-closeup',
  'character-three-quarter',
  'secret-cat',
  'secret-beacon',
  'secret-elevator',
  'secret-ghost-night',
];
const TIMES: readonly TimeOfDay[] = ['day', 'night'];
const TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

/** Look-dev switches that turn one subsystem off at a time. */
export type DebugFlag =
  | 'nofog'
  | 'noreflect'
  | 'nopost'
  | 'noclouds'
  | 'noshadow'
  | 'nobloom'
  | 'noao'
  | 'walkcycle'
  | 'walk'
  // Tone-mapping A/B for look development.
  | 'tm-aces'
  | 'tm-neutral';
const DEBUG_FLAGS: readonly DebugFlag[] = [
  'nofog',
  'noreflect',
  'nopost',
  'noclouds',
  'noshadow',
  'nobloom',
  'noao',
  'tm-aces',
  'tm-neutral',
  'walkcycle',
  'walk',
];

export interface ShotParams {
  shot?: ShotName;
  time?: TimeOfDay;
  quality?: QualityTier;
  debug?: DebugFlag[];
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function parseShotParams(search: string): ShotParams {
  const query = new URLSearchParams(search);
  const params: ShotParams = {};
  const shot = oneOf(query.get('shot'), SHOT_NAMES);
  const time = oneOf(query.get('time'), TIMES);
  const quality = oneOf(query.get('quality'), TIERS);
  if (shot) params.shot = shot;
  if (time) params.time = time;
  if (quality) params.quality = quality;
  const debug = (query.get('debug') ?? '')
    .split(',')
    .filter((f): f is DebugFlag => (DEBUG_FLAGS as readonly string[]).includes(f));
  if (debug.length) params.debug = debug;
  return params;
}

export interface DebugStats {
  drawCalls: number;
  triangles: number;
  dpr: number;
  tier: QualityTier;
  budget: { drawCalls: number; triangles: number };
  withinBudget: boolean;
}

export interface DebugHandle {
  ready: boolean;
  frame: number;
  errors: string[];
  stats(): DebugStats;
  /** Bind-pose proportions of UR-01 once it has loaded. */
  character?: () => { height: number; widthRatio: number; depthRatio: number };
  /** Photo mode for the shot harness. */
  photo?: {
    enter(): Promise<{ ok: boolean; message?: string }>;
    status(): { phase: string; samples: number; target: number } | null;
    triangles(): number;
  };
  /** Delivers a click on this target to the interface, as a real click in the city would. */
  pick?: (target: PickTarget) => void;
  /**
   * Frame-by-frame capture: while held, the loop draws only requested frames, each advancing the city by
   * exactly `dt` however long it takes to render, and the district signs are hidden.
   */
  hold?: (on: boolean) => void;
  capture?: (o: CaptureRequest) => Promise<string>;
}

export interface CaptureRequest {
  /** Seconds of city time this frame advances. */
  dt: number;
  position: [number, number, number];
  target: [number, number, number];
  type: 'image/webp' | 'image/png' | 'image/jpeg';
  quality?: number;
}

declare global {
  interface Window {
    __eukalpia?: DebugHandle;
  }
}

/** Exposes frame progress and render stats for the visual shot harness. */
export function installDebug(stats: () => DebugStats): DebugHandle {
  const handle: DebugHandle = { ready: false, frame: 0, errors: [], stats };
  if (typeof window !== 'undefined') window.__eukalpia = handle;
  return handle;
}
