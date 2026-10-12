import {
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  SpotLight,
  Vector3,
  type Camera,
} from 'three';
import type { CharacterModel } from './model';

export interface Presence {
  group: Group;
  /** Contact shadows under the left and right foot. */
  feet: [Mesh, Mesh];
  /** Current opacity of a foot's contact shadow (0 left, 1 right). */
  opacity(foot: 0 | 1): number;
  update(camera: Camera, night: boolean): void;
  dispose(): void;
}

const FOOT_OPACITY = 0.6;
const BODY_OPACITY = 0.32;
const LIFT_FADE = 0.35;
const NEAR = 8;
const FAR = 25;

/** Soft round falloff in every channel (alphaMap reads green). */
function blobTexture(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const v = Math.round(255 * Math.pow(1 - r * r * (3 - 2 * r), 1.6));
      data.set([v, v, v, v], (y * size + x) * 4);
    }
  const t = new DataTexture(data, size, size);
  t.magFilter = t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Grounds UR-01: soft contact shadows under the feet and body, and a gentle rim and fill light that
 * follow the camera for close views (the sun alone leaves a dark coat flat in shade).
 */
export function createPresence(model: CharacterModel): Presence {
  const group = new Group();
  group.name = 'UR-01 presence';
  const texture = blobTexture();
  const blob = (w: number, d: number, opacity: number) => {
    const m = new Mesh(
      new PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: 0x000000, alphaMap: texture, transparent: true, opacity, depthWrite: false }),
    );
    m.renderOrder = 1;
    group.add(m);
    return m;
  };
  const feet: [Mesh, Mesh] = [blob(0.34, 0.5, FOOT_OPACITY), blob(0.34, 0.5, FOOT_OPACITY)];
  const body = blob(1.1, 0.85, BODY_OPACITY);

  // No shadow: three's shadow pass would draw every caster in the cone (whole instanced streets)
  // and cannot be limited to UR-01; the sun's cascades already shade its folds.
  const rim = new SpotLight(0xfff1e2, 0, 9, 0.55, 1, 2);
  const fill = new SpotLight(0xdfe8ff, 0, 9, 0.7, 1, 2);
  const target = new Object3D();
  rim.target = target;
  fill.target = target;
  group.add(rim, fill, target);

  const v = new Vector3();
  const eye = new Vector3();
  const chest = new Vector3();
  const toward = new Vector3();
  const right = new Vector3();
  const up = new Vector3(0, 1, 0);
  const groundY = () => model.root.position.y;

  const presence: Presence = {
    group,
    feet,
    opacity: i => (feet[i].material as MeshBasicMaterial).opacity,
    update(camera, night) {
      model.root.updateMatrixWorld(true);
      const y = groundY() + 0.012;
      (['foot.L', 'foot.R'] as const).forEach((name, i) => {
        const bone = model.bones.get(name);
        if (!bone) return;
        bone.getWorldPosition(v);
        feet[i].position.set(v.x, y, v.z);
        feet[i].rotation.y = model.root.rotation.y;
        const lift = Math.max(0, v.y - groundY() - 0.1);
        (feet[i].material as MeshBasicMaterial).opacity = FOOT_OPACITY * Math.max(0, 1 - lift / LIFT_FADE);
      });
      const pelvis = model.bones.get('pelvis');
      if (pelvis) pelvis.getWorldPosition(v);
      else v.copy(model.root.position);
      body.position.set(v.x, y - 0.002, v.z);
      body.rotation.y = model.root.rotation.y;
      body.visible = model.root.visible;
      for (const f of feet) f.visible = model.root.visible;

      // Lights: rim from behind the character (as seen from the camera), fill from the camera's side.
      const chestBone = model.bones.get('chest');
      if (chestBone) chestBone.getWorldPosition(chest);
      else chest.copy(model.root.position).y += 1.3;
      camera.getWorldPosition(eye);
      toward.subVectors(chest, eye).setY(0);
      const distance = toward.length();
      toward.normalize();
      right.crossVectors(toward, up);
      const near = 1 - Math.min(1, Math.max(0, (distance - NEAR) / (FAR - NEAR)));
      target.position.copy(chest);
      rim.position
        .copy(chest)
        .addScaledVector(toward, 2.2)
        .addScaledVector(right, 0.9)
        .add(v.set(0, 1.6, 0));
      fill.position
        .copy(chest)
        .addScaledVector(toward, -2.6)
        .addScaledVector(right, -1.2)
        .add(v.set(0, 0.6, 0));
      rim.intensity = (night ? 14 : 22) * near;
      fill.intensity = (night ? 4 : 6) * near;
      rim.visible = fill.visible = near > 0 && model.root.visible;
    },
    dispose() {
      texture.dispose();
      for (const m of [...feet, body]) {
        m.geometry.dispose();
        (m.material as MeshBasicMaterial).dispose();
      }
      rim.dispose();
      fill.dispose();
    },
  };
  return presence;
}
