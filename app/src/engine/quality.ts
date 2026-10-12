export type QualityTier = 'high' | 'medium' | 'low';

export const BUDGETS: Record<QualityTier, { drawCalls: number; triangles: number }> = {
  high: { drawCalls: 900, triangles: 6_000_000 },
  medium: { drawCalls: 600, triangles: 3_000_000 },
  low: { drawCalls: 300, triangles: 1_200_000 },
};

export interface TierSettings {
  csmCascades: number;
  shadowMapSize: number;
  ao: 'full' | 'half' | 'off';
  /** Raymarch steps for the volumetric cloud sea; 0 renders cheap 2D layers instead. */
  cloudSteps: number;
  interiorFurniture: boolean;
  maxDpr: number;
}

export const TIER_SETTINGS: Record<QualityTier, TierSettings> = {
  high: { csmCascades: 4, shadowMapSize: 2048, ao: 'full', cloudSteps: 48, interiorFurniture: true, maxDpr: 2 },
  medium: { csmCascades: 3, shadowMapSize: 2048, ao: 'half', cloudSteps: 24, interiorFurniture: true, maxDpr: 1.5 },
  low: { csmCascades: 2, shadowMapSize: 1024, ao: 'off', cloudSteps: 0, interiorFurniture: false, maxDpr: 1.5 },
};

export interface DeviceInfo {
  mobile: boolean;
  cores: number;
  renderer: string;
  screenArea: number;
}

const INTEGRATED_GPU = /intel|uhd|iris|mali|adreno|powervr/i;
/** Base Apple silicon (M1/M2 without Pro, Max or Ultra) has integrated-class GPU throughput. */
const BASE_APPLE_SILICON = /Apple M[12](?![\w ]*(Pro|Max|Ultra))/;

export interface BrowserEnvironment {
  userAgent: string;
  maxTouchPoints: number;
  hardwareConcurrency: number;
  renderer: string;
  screenArea: number;
}

/** Turns what the browser reports into DeviceInfo. iPadOS reports a desktop Mac UA but has touch. */
export function readDeviceInfo(env: BrowserEnvironment): DeviceInfo {
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(env.userAgent);
  const touchMac = /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
  return {
    mobile: mobileUa || touchMac,
    cores: env.hardwareConcurrency || 4,
    renderer: env.renderer,
    screenArea: env.screenArea,
  };
}

export function detectTier(info: DeviceInfo): QualityTier {
  if (info.mobile) return 'low';
  if (INTEGRATED_GPU.test(info.renderer) || BASE_APPLE_SILICON.test(info.renderer) || info.cores < 6) return 'medium';
  return 'high';
}

const SLOW_FRAME_MS = 22;
// 18 ms so that a vsync-locked 60 Hz display (16.7 ms) counts as fast.
const FAST_FRAME_MS = 18;
const SLOW_HOLD_S = 1;
const FAST_HOLD_S = 3;
const STEP = 0.15;
const MIN_DPR = 0.6;
const SLOW_CEILING_S = 20;

/** Lowers the pixel ratio while frames are slow and restores it once they are fast again. */
export class AdaptiveResolution {
  private ema = 16;
  private slowFor = 0;
  private fastFor = 0;
  private dpr: number;
  /** After a slow spell, DPR stays below the slow level for a while so it does not oscillate. */
  private ceiling = Infinity;
  private ceilingFor = 0;

  constructor(private readonly maxDpr: number) {
    this.dpr = maxDpr;
  }

  update(frameMs: number, dtSec: number): number | null {
    this.ema += (frameMs - this.ema) * 0.1;
    if (this.ceiling !== Infinity && (this.ceilingFor -= dtSec) <= 0) this.ceiling = Infinity;
    this.slowFor = this.ema > SLOW_FRAME_MS ? this.slowFor + dtSec : 0;
    this.fastFor = this.ema < FAST_FRAME_MS ? this.fastFor + dtSec : 0;

    let next = this.dpr;
    if (this.slowFor >= SLOW_HOLD_S) {
      next = Math.max(MIN_DPR, this.dpr - STEP);
      this.ceiling = next;
      this.ceilingFor = SLOW_CEILING_S;
    } else if (this.fastFor >= FAST_HOLD_S) {
      next = Math.min(this.maxDpr, this.ceiling, this.dpr + STEP);
    }
    if (Math.abs(next - this.dpr) < 1e-9) return null;

    this.dpr = Math.round(next * 100) / 100;
    this.slowFor = 0;
    this.fastFor = 0;
    return this.dpr;
  }
}
