import { Box3, Line3, Vector3 } from 'three';
import type { CollisionWorld } from '../world/collision';

export const CAPSULE_RADIUS = 0.32;
export const CAPSULE_HEIGHT = 1.824;
export const WALK_SPEED = 1.6;
export const RUN_SPEED = 4.2;
export const JUMP_HEIGHT = 1.1;
export const STEP_HEIGHT = 0.35;
const GRAVITY = 9.81;
const MAX_STEP = 1 / 120;
const ACCELERATION = 14;

export interface MoveInput {
  /** −1..1 along the facing direction. */
  forward: number;
  /** −1..1 to the right of the facing direction. */
  right: number;
  run: boolean;
  jump: boolean;
}

export interface Controller {
  /** Feet position. */
  position: Vector3;
  velocity: Vector3;
  grounded: boolean;
  /** Facing: 0 looks down −z, π/2 looks down −x (camera convention). */
  yaw: number;
  update(dt: number, input: MoveInput): void;
  teleport(p: Vector3): void;
}

const segment = new Line3();
const box = new Box3();
const triPoint = new Vector3();
const capsulePoint = new Vector3();
const direction = new Vector3();

/** A capsule that walks over the BVH: gravity, step-up, jumping, and no tunnelling. */
export function createController(world: CollisionWorld, spawn: Vector3): Controller {
  const position = spawn.clone();
  const velocity = new Vector3();
  const start = new Vector3();
  const c: Controller = {
    position,
    velocity,
    grounded: false,
    yaw: 0,
    update(dt, input) {
      let remaining = Math.min(dt, 0.25);
      let jump = input.jump;
      while (remaining > 1e-6) {
        const h = Math.min(MAX_STEP, remaining);
        remaining -= h;
        step(h, input, jump);
        jump = false;
      }
    },
    teleport(p) {
      let x = p.x;
      let z = p.z;
      let ground = world.groundAt(x, z, p.y + 500);
      if (ground === null) {
        // Over the void: walk the point in towards the nearest island until there is ground.
        const island = [...world.islands].sort(
          (a, b) => Math.hypot(x - a.cx, z - a.cz) - a.radius - (Math.hypot(x - b.cx, z - b.cz) - b.radius),
        )[0];
        const d = Math.hypot(x - island.cx, z - island.cz) || 1;
        const r = Math.max(0, island.radius - 20);
        x = island.cx + ((x - island.cx) / d) * Math.min(r, d);
        z = island.cz + ((z - island.cz) / d) * Math.min(r, d);
        ground = world.groundAt(x, z, island.topY + 500) ?? island.topY;
      }
      position.set(x, ground + 0.02, z);
      velocity.set(0, 0, 0);
    },
  };

  function resolve() {
    // Sideways collisions use a capsule raised by STEP_HEIGHT: anything lower is stepped over and
    // handled by the ground snap below.
    const bottom = position.y + STEP_HEIGHT + CAPSULE_RADIUS;
    segment.start.set(position.x, bottom, position.z);
    segment.end.set(position.x, Math.max(bottom, position.y + CAPSULE_HEIGHT - CAPSULE_RADIUS), position.z);
    start.copy(segment.start);
    box.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(CAPSULE_RADIUS);
    world.bvh.shapecast({
      intersectsBounds: b => b.intersectsBox(box),
      intersectsTriangle: tri => {
        const distance = tri.closestPointToSegment(segment, triPoint, capsulePoint);
        if (distance < CAPSULE_RADIUS) {
          const depth = CAPSULE_RADIUS - distance;
          direction.subVectors(capsulePoint, triPoint).normalize();
          segment.start.addScaledVector(direction, depth);
          segment.end.addScaledVector(direction, depth);
        }
      },
    });
    position.x = segment.start.x;
    position.z = segment.start.z;
    // Ceilings may push down; floors are handled by the ground snap, not by the capsule.
    position.y = Math.min(position.y, segment.start.y - STEP_HEIGHT - CAPSULE_RADIUS);
  }

  function step(h: number, input: MoveInput, jump: boolean) {
    const speed = input.run ? RUN_SPEED : WALK_SPEED;
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    const rx = Math.cos(c.yaw);
    const rz = -Math.sin(c.yaw);
    let wx = fx * input.forward + rx * input.right;
    let wz = fz * input.forward + rz * input.right;
    const len = Math.hypot(wx, wz);
    if (len > 1) {
      wx /= len;
      wz /= len;
    }
    const k = Math.min(1, ACCELERATION * h);
    velocity.x += (wx * speed - velocity.x) * k;
    velocity.z += (wz * speed - velocity.z) * k;

    if (jump && c.grounded) {
      velocity.y = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
      c.grounded = false;
    }
    if (!c.grounded) velocity.y -= GRAVITY * h;

    const prevY = position.y;
    position.addScaledVector(velocity, h);
    resolve();

    // Ground snap: cast from above the higher of the old and new feet so a fast fall can't skip a floor.
    const ground = world.groundAt(position.x, position.z, Math.max(prevY, position.y) + STEP_HEIGHT);
    if (ground !== null && velocity.y <= 0 && position.y <= ground + 0.02) {
      position.y = ground;
      velocity.y = 0;
      c.grounded = true;
    } else if (ground !== null && c.grounded && velocity.y <= 0 && position.y - ground <= STEP_HEIGHT) {
      // Walking down a kerb: stay glued to the ground instead of hopping off.
      position.y = ground;
      velocity.y = 0;
    } else {
      c.grounded = false;
    }
  }

  return c;
}
