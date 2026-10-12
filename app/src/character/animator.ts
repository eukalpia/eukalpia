import { Quaternion, Vector3, type Bone } from 'three';
import { footLift, footReach, gaitPhase, solveTwoBone, strideFor, STANCE } from './gait';
import type { BoneName, CharacterModel } from './model';

export interface AnimatorState {
  /** Horizontal speed in m/s. */
  speed: number;
  grounded: boolean;
  verticalSpeed: number;
  /** Yaw rate in rad/s (positive turns left). */
  turnRate: number;
  /** Ground height under each foot relative to the character's feet (m). */
  groundL: number;
  groundR: number;
}

export interface Animator {
  update(dt: number, s: AnimatorState): void;
  reset(): void;
}

const MODEL_X = new Vector3(1, 0, 0);
const MODEL_Y = new Vector3(0, 1, 0);
const MODEL_Z = new Vector3(0, 0, 1);
const UPPER_LEG = 0.42;
const LOWER_LEG = 0.39;

interface Rig {
  bone: Bone;
  bind: Quaternion;
  /** Model-space X, Y, Z expressed in this bone's local frame (bind pose). */
  ax: Vector3;
  ay: Vector3;
  az: Vector3;
}

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Procedural animation for the UR-01 rig. Angles are given about model axes (character facing +z):
 * pitch about X, yaw about Y, roll about Z. For a bone pointing down, positive pitch swings it backwards.
 */
export function createAnimator(model: CharacterModel): Animator {
  const rigs = new Map<BoneName, Rig>();
  const modelQ = new Map<Bone, Quaternion>();
  const modelP = new Map<Bone, Vector3>();
  const root = model.bones.get('root');
  if (!root) throw new Error('UR-01 rig has no root bone');

  // Bind-pose model-space transforms, walking down from the root bone.
  const walk = (bone: Bone, parentQ: Quaternion, parentP: Vector3) => {
    const q = parentQ.clone().multiply(bone.quaternion);
    const p = bone.position.clone().applyQuaternion(parentQ).add(parentP);
    modelQ.set(bone, q);
    modelP.set(bone, p);
    for (const child of bone.children) if ((child as Bone).isBone) walk(child as Bone, q, p);
  };
  walk(root, new Quaternion(), new Vector3());

  for (const [name, bone] of model.bones) {
    const inv = modelQ.get(bone)!.clone().invert();
    rigs.set(name, {
      bone,
      bind: bone.quaternion.clone(),
      ax: MODEL_X.clone().applyQuaternion(inv),
      ay: MODEL_Y.clone().applyQuaternion(inv),
      az: MODEL_Z.clone().applyQuaternion(inv),
    });
  }
  const pelvis = model.bones.get('pelvis')!;
  const pelvisBindY = pelvis.position.y;
  const hipY = modelP.get(model.bones.get('thigh.L')!)!.y;
  const ankleY = modelP.get(model.bones.get('foot.L')!)!.y;

  // A-pose arms: how far each arm hangs out from vertical, to relax it towards the body.
  const shoulder = modelP.get(model.bones.get('upper_arm.L')!)!;
  const hand = modelP.get(model.bones.get('hand.L')!)!;
  const armOut = Math.atan2(hand.x - shoulder.x, shoulder.y - hand.y);
  const relax = Math.max(0, armOut - 0.12);

  const qa = new Quaternion();
  const qb = new Quaternion();
  const qc = new Quaternion();
  function pose(name: BoneName, pitch = 0, yaw = 0, roll = 0) {
    const r = rigs.get(name);
    if (!r) return;
    r.bone.quaternion
      .copy(r.bind)
      .multiply(qa.setFromAxisAngle(r.ax, pitch))
      .multiply(qb.setFromAxisAngle(r.ay, yaw))
      .multiply(qc.setFromAxisAngle(r.az, roll));
  }

  let distance = 0;
  let time = 0;
  let landing = 0;
  let wasGrounded = true;
  let lean = 0;
  const pelvisBindX = pelvis.position.x;
  const legLength = hipY - ankleY;
  // Coat tails: angle and angular velocity of a damped spring per side.
  const coat = { L: { a: 0, v: 0 }, R: { a: 0, v: 0 } };
  const spring = (s: { a: number; v: number }, target: number, dt: number) => {
    const k = 60;
    const damping = 2 * Math.sqrt(k) * 0.35;
    s.v += (k * (target - s.a) - damping * s.v) * dt;
    s.a += s.v * dt;
    return s.a;
  };
  // Smooth wandering value in −1..1 from a few incommensurate sines.
  const wander = (t: number, seed: number) =>
    (Math.sin(t * 0.37 + seed) + 0.6 * Math.sin(t * 0.83 + seed * 2.1) + 0.3 * Math.sin(t * 1.9 + seed * 3.7)) / 1.9;

  function leg(
    side: 'L' | 'R',
    phase: number,
    moving: number,
    stride: number,
    speed: number,
    ground: number,
    pelvisDrop: number,
    airborne: number,
    lateral: number,
    hipRoll: number,
  ) {
    const reach = footReach(phase) * stride * (1 - STANCE) * moving;
    const lift = footLift(phase, speed) * moving;
    // Hip-to-ankle vector in the sagittal plane (z forward, y down).
    const hip = hipY - pelvisDrop;
    const targetY = ankleY + Math.max(0, ground) + lift + airborne * 0.28;
    const dz = reach + airborne * 0.12;
    const dy = hip - targetY;
    const d = Math.hypot(dz, dy);
    const { hip: h, knee } = solveTwoBone(UPPER_LEG, LOWER_LEG, d);
    const alpha = Math.atan2(dz, dy);
    const thighPitch = -(alpha + h);
    // A sideways pelvis shift is taken up by rolling the leg at the hip and back at the ankle.
    const roll = Math.atan2(lateral, legLength) - hipRoll;
    pose(`thigh.${side}`, thighPitch, 0, roll);
    pose(`shin.${side}`, knee, 0, 0);
    // Keep the sole level; peel the heel off at the end of stance.
    const toeOff = phase > STANCE - 0.12 && phase < STANCE + 0.05 ? (phase - (STANCE - 0.12)) / 0.17 : 0;
    pose(`foot.${side}`, alpha + h - knee - toeOff * 0.45 * moving, 0, -roll);
    pose(`toe.${side}`, -toeOff * 0.5 * moving, 0, 0);
    return reach;
  }

  return {
    update(dt, s) {
      time += dt;
      const speed = Math.max(0, s.speed);
      const moving = smooth(speed, 0.05, 0.6);
      const run = smooth(speed, 2.2, 4.0);
      const stride = strideFor(speed);
      distance += speed * dt;
      const phaseL = gaitPhase(distance, stride);
      const phaseR = (phaseL + 0.5) % 1;
      const airborne = s.grounded ? 0 : smooth(Math.abs(s.verticalSpeed), 0.5, 3);

      if (s.grounded && !wasGrounded) landing = 0.22;
      wasGrounded = s.grounded;
      landing = Math.max(0, landing - dt);
      const landDip = landing > 0 ? Math.sin((landing / 0.22) * Math.PI) * 0.12 : 0;

      // Pelvis: lowers a little while walking, bobs twice per cycle, dips on landing; sinks to the lower foot.
      const bob = (0.5 - 0.5 * Math.cos(4 * Math.PI * phaseL)) * (0.02 + 0.03 * run) * moving;
      const drop = 0.025 * moving + 0.03 * run + bob + landDip - Math.min(0, Math.min(s.groundL, s.groundR));
      pelvis.position.y = pelvisBindY - drop;
      // Standing, the weight drifts from one foot to the other every ~6.5 s.
      const still = 1 - moving;
      const shift = 0.018 * Math.sin((time * Math.PI * 2) / 6.5) * still;
      pelvis.position.x = pelvisBindX + shift;
      const sway = Math.sin(2 * Math.PI * phaseL) * moving;
      lean += (run * 0.16 + moving * 0.03 - lean) * Math.min(1, dt * 4);
      const turnLean = Math.max(-0.12, Math.min(0.12, s.turnRate * speed * 0.03));
      // The hips tilt with the weight shift; the legs take that tilt back out below.
      const weightRoll = shift * 1.4;
      pose('pelvis', lean * 0.3, sway * 0.12, turnLean + sway * 0.03 + weightRoll);

      const reachL = leg('L', phaseL, moving, stride, speed, s.groundL, drop, airborne, -shift, weightRoll);
      const reachR = leg('R', phaseR, moving, stride, speed, s.groundR, drop, airborne, -shift, weightRoll);

      // Torso counter-rotates against the pelvis; breathing when idle.
      const breath = Math.sin(time * Math.PI * 0.5) * 0.02 * (1 - moving);
      pose('spine', lean * 0.4 + breath, -sway * 0.1, 0);
      pose('chest', lean * 0.3 - breath * 0.5, -sway * 0.08, -turnLean * 0.5);
      // Now and then UR-01 looks around: slow yaw, a little pitch.
      const look = wander(time * 0.6, 1.3) * 0.32 * still;
      const nod = wander(time * 0.5, 4.1) * 0.06 * still;
      pose('neck', -lean * 0.5 + nod * 0.4, sway * 0.04 + look * 0.4, -shift * 0.8);
      pose('head', -lean * 0.2 + breath * 0.3 + nod * 0.6, sway * 0.03 + look * 0.6, 0);

      // Arms hang closer to the body and swing opposite to the legs.
      const swingL = (reachR / Math.max(0.3, stride * 0.4)) * (0.35 + 0.35 * run);
      const swingR = (reachL / Math.max(0.3, stride * 0.4)) * (0.35 + 0.35 * run);
      const airArms = airborne * 0.35;
      pose('upper_arm.L', -swingL + run * 0.2, 0, -relax + airArms);
      pose('upper_arm.R', -swingR + run * 0.2, 0, relax - airArms);
      const elbow = 0.18 + 0.9 * run + 0.2 * moving;
      pose('forearm.L', -elbow - Math.max(0, swingL) * 0.3, 0, 0);
      pose('forearm.R', -elbow - Math.max(0, swingR) * 0.3, 0, 0);
      pose('hand.L', 0, 0, 0.05 * moving);
      pose('hand.R', 0, 0, -0.05 * moving);

      // Coat tails trail behind with speed and flutter; they lift when falling.
      const trail = Math.min(0.5, speed * 0.07) + airborne * 0.3;
      const flutter = Math.sin(time * (6 + speed * 2)) * 0.04 * moving;
      // The tails chase their target on a spring, so they swing on after a stop and settle.
      const coatL = spring(coat.L, trail + flutter - reachL * 0.4, dt);
      const coatR = spring(coat.R, trail - flutter - reachR * 0.4, dt);
      pose('coat.L', coatL, 0, turnLean * 0.5);
      pose('coat.R', coatR, 0, turnLean * 0.5);
      pose('coat_tip.L', coatL * 0.6 + flutter * 1.5, 0, 0);
      pose('coat_tip.R', coatR * 0.6 - flutter * 1.5, 0, 0);
    },
    reset() {
      for (const r of rigs.values()) r.bone.quaternion.copy(r.bind);
      pelvis.position.y = pelvisBindY;
      pelvis.position.x = pelvisBindX;
      coat.L = { a: 0, v: 0 };
      coat.R = { a: 0, v: 0 };
      distance = 0;
      landing = 0;
      lean = 0;
    },
  };
}
