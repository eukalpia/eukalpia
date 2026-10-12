import { MathUtils, Vector3 } from 'three';

export type TimeOfDay = 'day' | 'night';

export interface LightingPreset {
  sunElevationDeg: number;
  /** Compass bearing of the sun or moon: 0 = north (−z), 90 = east (+x), 180 = south (+z). */
  sunAzimuthDeg: number;
  sunColor: number;
  sunIntensity: number;
  exposure: number;
  turbidity: number;
  rayleigh: number;
  envIntensity: number;
  fogColor: number;
  fogDensity: number;
  fogHeightFalloff: number;
  windowLitRatio: number;
  bloomThreshold: number;
  bloomIntensity: number;
}

export const PRESETS: Record<TimeOfDay, LightingPreset> = {
  day: {
    // Late afternoon: a low warm sun gives long shadows and warm/cool contrast.
    sunElevationDeg: 18,
    sunAzimuthDeg: 238,
    sunColor: 0xffd2a1,
    sunIntensity: 5.2,
    exposure: 0.58,
    turbidity: 3.2,
    rayleigh: 1.5,
    envIntensity: 0.75,
    fogColor: 0xb9c6d4,
    fogDensity: 0.00008,
    fogHeightFalloff: 0.0016,
    windowLitRatio: 0.04,
    bloomThreshold: 2.4,
    bloomIntensity: 0.35,
  },
  night: {
    sunElevationDeg: 38,
    sunAzimuthDeg: 140,
    sunColor: 0x9fb4ff,
    sunIntensity: 0.22,
    exposure: 1.6,
    turbidity: 0.1,
    rayleigh: 0.1,
    envIntensity: 0.18,
    fogColor: 0x0d1420,
    fogDensity: 0.00035,
    fogHeightFalloff: 0.0012,
    windowLitRatio: 0.28,
    bloomThreshold: 0.62,
    bloomIntensity: 0.9,
  },
};

/** Unit vector pointing from the scene towards the sun (day) or moon (night). */
export function sunDirection(p: LightingPreset, target = new Vector3()): Vector3 {
  const el = MathUtils.degToRad(p.sunElevationDeg);
  const az = MathUtils.degToRad(p.sunAzimuthDeg);
  return target.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
}
