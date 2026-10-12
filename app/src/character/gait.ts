/**
 * Planar two-bone IK. Returns the hip angle (between the upper bone and the hip→target line)
 * and the knee bend (0 = straight, positive bends one way only). Unreachable targets straighten the leg.
 */
export function solveTwoBone(upper: number, lower: number, target: number): { hip: number; knee: number } {
  const reach = upper + lower;
  if (target >= reach - 1e-9) return { hip: 0, knee: 0 };
  const d = Math.max(Math.abs(upper - lower) + 1e-6, target);
  const hip = Math.acos(Math.min(1, Math.max(-1, (upper * upper + d * d - lower * lower) / (2 * upper * d))));
  const interior = Math.acos(Math.min(1, Math.max(-1, (upper * upper + lower * lower - d * d) / (2 * upper * lower))));
  return { hip, knee: Math.PI - interior };
}

/** Phase of the gait cycle in [0, 1): one full cycle (left and right step) per stride length. */
export function gaitPhase(distance: number, stride: number): number {
  const p = (distance / stride) % 1;
  return p < 0 ? p + 1 : p;
}

/** Stance fraction of the cycle: the foot is planted for the first 60 %. */
export const STANCE = 0.6;

/** How high a foot is lifted at this phase; zero during stance, higher when running. */
export function footLift(phase: number, speed: number): number {
  if (phase < STANCE) return 0;
  const t = (phase - STANCE) / (1 - STANCE);
  const run = Math.min(1, Math.max(0, (speed - 1.6) / 2.6));
  return Math.sin(Math.PI * t) * (0.09 + 0.08 * run);
}

/** Forward offset of a foot from under the hip at this phase, as a fraction of the step length (−0.5..0.5). */
export function footReach(phase: number): number {
  if (phase < STANCE) return 0.5 - phase / STANCE;
  const t = (phase - STANCE) / (1 - STANCE);
  // Smooth swing from behind to in front.
  return -0.5 + t * t * (3 - 2 * t);
}

/** Stride length (one full cycle) for a speed in m/s; longer and slightly faster cadence when running. */
export function strideFor(speed: number): number {
  return 1.1 + Math.min(1, speed / 4.2) * 1.3;
}
