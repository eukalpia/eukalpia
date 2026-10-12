import { Vector3, type PerspectiveCamera } from 'three';
import type { CollisionWorld } from '../world/collision';
import { createAnimator, type Animator } from './animator';
import { createWalkCameras, type WalkCameras } from './cameras';
import { createController, type Controller } from './controller';
import { createInput, type Input, type InputAction } from './input';
import type { CharacterModel } from './model';

export interface Walk {
  readonly active: boolean;
  readonly controller: Controller;
  readonly cameras: WalkCameras;
  readonly input: Input;
  readonly animator: Animator;
  enter(at?: Vector3): void;
  exit(): void;
  /** Keys and look while walking; off while a panel or card covers the city, or motion is paused. */
  setInputActive(on: boolean): void;
  update(dt: number): void;
  /** Drives the idle character while not walking (breathing, or a demo cycle). */
  idle(dt: number, demoSpeed?: number): void;
  onAction(fn: (a: InputAction) => void): void;
  dispose(): void;
}

const LOOK_X = 0.0025;
const LOOK_Y = 0.002;
const PITCH_MIN = -1.1;
const PITCH_MAX = 0.6;
const TURN_RATE = 10;

export function createWalk(ctx: {
  camera: PerspectiveCamera;
  canvas: HTMLCanvasElement;
  world: CollisionWorld;
  model: CharacterModel;
  spawn: Vector3;
}): Walk {
  const { camera, canvas, world, model } = ctx;
  const input = createInput(window);
  const controller = createController(world, ctx.spawn);
  controller.teleport(ctx.spawn);
  const animator = createAnimator(model);
  const cameras = createWalkCameras(camera, world);
  const actions: ((a: InputAction) => void)[] = [];
  let active = false;
  let yaw = Math.PI; // camera looks towards +z, along the character's bind facing
  let pitch = -0.12;
  let facing = 0;
  let dragging = false;

  model.root.position.copy(controller.position);

  const onMove = (e: PointerEvent) => {
    if (!active) return;
    if (document.pointerLockElement !== canvas && !dragging) return;
    yaw -= e.movementX * LOOK_X;
    pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitch - e.movementY * LOOK_Y));
  };
  const onDown = (e: PointerEvent) => {
    if (!active) return;
    if (e.pointerType === 'mouse' && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    else dragging = true;
  };
  const onUp = () => (dragging = false);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  input.onAction(a => {
    if (!active) return;
    if (a === 'view') cameras.toggle();
    if (a === 'exit') walk.exit();
    for (const fn of actions) fn(a);
  });

  const left = new Vector3();
  const walk: Walk = {
    get active() {
      return active;
    },
    controller,
    cameras,
    input,
    animator,
    enter(at) {
      if (at) controller.teleport(at);
      active = true;
      input.setEnabled(true);
      model.root.visible = cameras.mode === 'third';
    },
    exit() {
      active = false;
      input.setEnabled(false);
      dragging = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      model.root.visible = true;
    },
    setInputActive(on) {
      if (!active) return;
      input.setEnabled(on);
      if (on) return;
      dragging = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    },
    update(dt) {
      if (!active) return;
      const state = input.state();
      controller.yaw = yaw;
      controller.update(dt, { ...state, jump: input.takeJump() });

      const vx = controller.velocity.x;
      const vz = controller.velocity.z;
      const speed = Math.hypot(vx, vz);
      let turnRate = 0;
      if (speed > 0.25) {
        const target = Math.atan2(vx, vz);
        const delta = Math.atan2(Math.sin(target - facing), Math.cos(target - facing));
        const stepAngle = delta * Math.min(1, dt * TURN_RATE);
        facing += stepAngle;
        turnRate = stepAngle / Math.max(dt, 1e-4);
      }
      model.root.position.copy(controller.position);
      model.root.rotation.y = facing;

      // Ground under each foot (character's left is +x in its own frame).
      left.set(Math.cos(facing) * 0.1, 0, -Math.sin(facing) * 0.1);
      const p = controller.position;
      const gl = world.groundAt(p.x + left.x, p.z + left.z, p.y + 0.5);
      const gr = world.groundAt(p.x - left.x, p.z - left.z, p.y + 0.5);
      animator.update(dt, {
        speed,
        grounded: controller.grounded,
        verticalSpeed: controller.velocity.y,
        turnRate,
        groundL: gl === null ? 0 : Math.max(-0.35, Math.min(0.35, gl - p.y)),
        groundR: gr === null ? 0 : Math.max(-0.35, Math.min(0.35, gr - p.y)),
      });
      model.root.visible = cameras.mode === 'third';
      cameras.update(dt, p, yaw, pitch);
    },
    idle(dt, demoSpeed = 0) {
      // The lift may carry UR-01 while the camera is in orbit.
      model.root.position.copy(controller.position);
      animator.update(dt, { speed: demoSpeed, grounded: true, verticalSpeed: 0, turnRate: 0, groundL: 0, groundR: 0 });
    },
    onAction(fn) {
      actions.push(fn);
    },
    dispose() {
      walk.exit();
      input.dispose();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    },
  };
  return walk;
}
