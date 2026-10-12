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

  function leg(
    side: 'L' | 'R',
    phase: number,
    moving: number,
    stride: number,
    speed: number,
    ground: number,
    pelvisDrop: number,
    airborne: number,
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
    pose(`thigh.${side}`, thighPitch, 0, 0);
    pose(`shin.${side}`, knee, 0, 0);
    // Keep the sole level; peel the heel off at the end of stance.
    const toeOff = phase > STANCE - 0.12 && phase < STANCE + 0.05 ? (phase - (STANCE - 0.12)) / 0.17 : 0;
    pose(`foot.${side}`, alpha + h - knee - toeOff * 0.45 * moving, 0, 0);
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
      const sway = Math.sin(2 * Math.PI * phaseL) * moving;
      lean += (run * 0.16 + moving * 0.03 - lean) * Math.min(1, dt * 4);
      const turnLean = Math.max(-0.12, Math.min(0.12, s.turnRate * speed * 0.03));
      pose('pelvis', lean * 0.3, sway * 0.12, turnLean + sway * 0.03);

      const reachL = leg('L', phaseL, moving, stride, speed, s.groundL, drop, airborne);
      const reachR = leg('R', phaseR, moving, stride, speed, s.groundR, drop, airborne);

      // Torso counter-rotates against the pelvis; breathing when idle.
      const breath = Math.sin(time * Math.PI * 0.5) * 0.02 * (1 - moving);
      pose('spine', lean * 0.4 + breath, -sway * 0.1, 0);
      pose('chest', lean * 0.3 - breath * 0.5, -sway * 0.08, -turnLean * 0.5);
      pose('neck', -lean * 0.5, sway * 0.04, 0);
      pose('head', -lean * 0.2 + breath * 0.3, sway * 0.03, 0);

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
      pose('coat.L', trail + flutter - reachL * 0.4, 0, turnLean * 0.5);
      pose('coat.R', trail - flutter - reachR * 0.4, 0, turnLean * 0.5);
      pose('coat_tip.L', trail * 0.6 + flutter * 1.5, 0, 0);
      pose('coat_tip.R', trail * 0.6 - flutter * 1.5, 0, 0);
    },
    reset() {
      for (const r of rigs.values()) r.bone.quaternion.copy(r.bind);
      pelvis.position.y = pelvisBindY;
      distance = 0;
      landing = 0;
      lean = 0;
    },
  };
}
