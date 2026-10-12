import { Box3, Group, Mesh, Quaternion, SkinnedMesh, Vector3, type Bone, type Material, type Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

export const UR01 = {
  height: 1.824,
  bones: [
    'root',
    'pelvis',
    'coat.L',
    'coat_tip.L',
    'coat.R',
    'coat_tip.R',
    'spine',
    'chest',
    'clavicle.L',
    'upper_arm.L',
    'forearm.L',
    'hand.L',
    'clavicle.R',
    'upper_arm.R',
    'forearm.R',
    'hand.R',
    'neck',
    'head',
    'thigh.L',
    'shin.L',
    'foot.L',
    'toe.L',
    'thigh.R',
    'shin.R',
    'foot.R',
    'toe.R',
  ] as const,
};

export type BoneName = (typeof UR01.bones)[number];

/** GLTFLoader strips `[]./:` from node names ("foot.L" → "footL"); compare names through this key. */
export function boneKey(name: string): string {
  return name.replace(/[\[\]\.:\/]/g, '').toLowerCase();
}

const BONE_BY_KEY = new Map<string, BoneName>(UR01.bones.map(b => [boneKey(b), b]));
export type CharacterVariant = 'desktop' | 'mobile';

export interface CharacterModel {
  root: Group;
  skinned: SkinnedMesh[];
  bones: Map<BoneName, Bone>;
  /** Bounding box in the bind pose, world space of `root`. */
  bindBounds(): Box3;
  dispose(): void;
}

export function characterUrl(variant: CharacterVariant, base: string): string {
  return `${base}models/ur01/${variant === 'mobile' ? 'character-mobile.glb' : 'character.glb'}`;
}

/** Loads UR01 at true scale (1.824 m) with an independent skeleton clone. */
export async function loadCharacter(variant: CharacterVariant, base: string): Promise<CharacterModel> {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(characterUrl(variant, base));
  } catch (error) {
    throw new Error(`UR-01 could not load: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = cloneSkinned(gltf.scene) as Group;
  root.name = 'UR-01';
  const skinned: SkinnedMesh[] = [];
  const bones = new Map<BoneName, Bone>();
  root.traverse(o => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
    if (o instanceof SkinnedMesh) skinned.push(o);
    const name = BONE_BY_KEY.get(boneKey(o.name));
    if ((o as Bone).isBone && name) bones.set(name, o as Bone);
  });
  const model: CharacterModel = {
    root,
    skinned,
    bones,
    bindBounds: () => measureBindPoseBox(model),
    dispose() {
      const materials = new Set<Material>();
      const textures = new Set<Texture>();
      for (const m of skinned) {
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
      }
      for (const mat of materials) {
        for (const v of Object.values(mat)) if (v && (v as Texture).isTexture) textures.add(v as Texture);
        mat.dispose();
      }
      for (const t of textures) t.dispose();
    },
  };
  return model;
}

function measureBindPoseBox(model: CharacterModel): Box3 {
  const saved: { bone: Bone; p: Vector3; q: Quaternion; s: Vector3 }[] = [];
  const skeletons = new Set(model.skinned.map(m => m.skeleton));
  for (const skeleton of skeletons)
    for (const bone of skeleton.bones)
      saved.push({ bone, p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() });
  for (const skeleton of skeletons) skeleton.pose();
  model.root.updateMatrixWorld(true);
  const box = new Box3();
  for (const m of model.skinned) box.union(new Box3().setFromObject(m, true));
  for (const { bone, p, q, s } of saved) {
    bone.position.copy(p);
    bone.quaternion.copy(q);
    bone.scale.copy(s);
  }
  model.root.updateMatrixWorld(true);
  return box;
}

/** Height and silhouette ratios in the bind pose; the animated pose is restored afterwards. */
export function measureBindPose(model: CharacterModel): { height: number; widthRatio: number; depthRatio: number } {
  const size = measureBindPoseBox(model).getSize(new Vector3());
  return { height: size.y, widthRatio: size.x / size.y, depthRatio: size.z / size.y };
}
