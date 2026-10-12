import type { QualityTier, TimeOfDay } from './world';

export type ShotName = 'orbit-day' | 'orbit-night' | 'underside' | 'skyline';

const SHOT_NAMES: readonly ShotName[] = ['orbit-day', 'orbit-night', 'underside', 'skyline'];
const TIMES: readonly TimeOfDay[] = ['day', 'night'];
const TIERS: readonly QualityTier[] = ['high', 'medium', 'low'];

export interface ShotParams {
  shot?: ShotName;
  time?: TimeOfDay;
  quality?: QualityTier;
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
