import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import type { District } from '../content/districts';
import type { LandmarkFrame } from './landmarks';

/**
 * Metres above the roof, by district index mod 4. v1 staggered by 2.2 units; at v2's orbit distance
 * that is a few pixels, so the steps are wide enough to separate neighbours on screen.
 */
export const SIGN_RISE = [14, 38, 62, 86] as const;
/** Sign height on screen (sprites that keep their size at any distance, to stay readable from orbit). */
const SIGN_SCREEN_HEIGHT = 0.018;
const SIGN_OPACITY = 0.96;
const DIMMED = 0.65;
const FONT = '500 78px "IBM Plex Mono", monospace';

/** A label's box on screen in normalised device coordinates (x, y at the bottom centre). */
export interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Lower goes first. */
  priority: number;
  behind?: boolean;
}

/** Greedy map-style placement: in priority order, a label shows unless it overlaps one already shown. */
export function placeLabels(rects: readonly LabelRect[]): boolean[] {
  const shown = rects.map(() => false);
  const placed: LabelRect[] = [];
  const order = rects.map((_, i) => i).sort((a, b) => rects[a].priority - rects[b].priority);
  for (const i of order) {
    const r = rects[i];
    if (r.behind || Math.abs(r.x) > 1 + r.w || r.y > 1 || r.y + r.h < -1) continue;
    const clash = placed.some(p => Math.abs(p.x - r.x) < (p.w + r.w) / 2 && r.y < p.y + p.h && p.y < r.y + r.h);
    if (clash) continue;
    shown[i] = true;
    placed.push(r);
  }
  return shown;
}

/** v1 painted each district's repo name in capitals. */
export const signText = (d: District) => d.name.toUpperCase();

/** v1's sign: dark plate, a bar in the district colour, glowing pale text, a thin underline. */
function paintSign(text: string, color: string): Texture {
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d')!;
  const draw = () => {
    g.font = FONT;
    canvas.width = Math.ceil(g.measureText(text).width) + 58;
    canvas.height = 128;
    g.font = FONT;
    g.fillStyle = 'rgba(8,17,25,.92)';
    g.fillRect(0, 0, canvas.width, 128);
    g.fillStyle = color;
    g.fillRect(0, 0, 5, 128);
    g.shadowColor = color;
    g.shadowBlur = 5;
    g.fillStyle = '#e1e8e7';
    g.fillText(text, 27, 89);
    g.shadowBlur = 0;
    g.globalAlpha = 0.55;
    g.fillStyle = color;
    g.fillRect(18, 117, canvas.width - 36, 1);
    g.globalAlpha = 1;
  };
  draw();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  // The face may still be loading: paint again once it is there.
  document.fonts?.load(FONT).then(() => {
    draw();
    texture.needsUpdate = true;
  });
  return texture;
}

export interface Signs {
  /** Poles and the selection ring: scenery, in the main scene. */
  group: Group;
  /** The labels themselves, drawn over the finished frame (no fog, clouds or tone mapping). */
  labels: Group;
  /** The square selection ring at the focused landmark's base. */
  ring: Mesh;
  setFocus(districtId: number | null): void;
  /** Hides labels that would overlap on screen (the focused one wins, then the nearest). */
  update(camera: Camera): void;
  /** Signs are hidden during the blackout. */
  setVisible(visible: boolean): void;
  dispose(): void;
}

export function createSigns(
  frames: ReadonlyMap<number, LandmarkFrame>,
  districts: readonly District[],
  opts: { texture?: (text: string, color: string) => Texture } = {},
): Signs {
  const texture = opts.texture ?? paintSign;
  const group = new Group();
  group.name = 'district-sign-poles';
  const labels = new Group();
  labels.name = 'district-signs';
  const sprites: Sprite[] = [];
  const poleGeometry = new CylinderGeometry(0.12, 0.12, 1, 5).translate(0, 0.5, 0);
  const poleMaterial = new MeshBasicMaterial({ color: 0x6a7780 });
  const poles = new InstancedMesh(poleGeometry, poleMaterial, Math.max(1, districts.length));
  poles.count = 0;
  poles.name = 'sign-poles';
  const m = new Matrix4();
  districts.forEach((d, i) => {
    const f = frames.get(d.id);
    if (!f) return;
    const map = texture(signText(d), d.color);
    const material = new SpriteMaterial({
      map,
      sizeAttenuation: false,
      transparent: true,
      opacity: SIGN_OPACITY,
      // Labels, not scenery: towers in front must not cut them.
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new Sprite(material);
    const rise = SIGN_RISE[i % SIGN_RISE.length];
    sprite.position.set(f.x, f.top + rise, f.z);
    // Sits on its pole.
    sprite.center.set(0.5, 0);
    const image = map.image as { width: number; height: number };
    sprite.scale.set((SIGN_SCREEN_HEIGHT * image.width) / image.height, SIGN_SCREEN_HEIGHT, 1);
    sprite.userData.districtId = d.id;
    sprite.renderOrder = 10;
    sprites.push(sprite);
    labels.add(sprite);
    m.makeScale(1, rise, 1).setPosition(f.x, f.top, f.z);
    poles.setMatrixAt(poles.count++, m);
  });
  poles.instanceMatrix.needsUpdate = true;
  poles.computeBoundingSphere();
  group.add(poles);

  const ring = new Mesh(
    new RingGeometry(0.98, 1, 4, 1).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ color: 0xf9ba80, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false }),
  );
  ring.name = 'selection-ring';
  ring.visible = false;
  ring.userData.photo = 'skip';
  group.add(ring);

  let focused: number | null = null;
  const v = new Vector3();
  const rects: LabelRect[] = sprites.map(() => ({ x: 0, y: 0, w: 0, h: 0, priority: 0 }));
  return {
    group,
    labels,
    ring,
    update(camera) {
      const p = (camera as PerspectiveCamera).projectionMatrix.elements;
      sprites.forEach((sprite, i) => {
        v.copy(sprite.position).applyMatrix4(camera.matrixWorldInverse);
        const r = rects[i];
        r.behind = v.z >= 0;
        const distance = -v.z;
        v.copy(sprite.position).project(camera);
        r.x = v.x;
        r.y = v.y;
        // Screen-constant sprites: their size in clip space is the scale times the projection.
        r.w = sprite.scale.x * p[0] * 1.08;
        r.h = sprite.scale.y * p[5] * 1.15;
        r.priority = sprite.userData.districtId === focused ? -1 : distance;
      });
      placeLabels(rects).forEach((shown, i) => (sprites[i].visible = shown));
    },
    setFocus(id) {
      focused = id;
      for (const s of sprites)
        (s.material as SpriteMaterial).opacity =
          id === null || s.userData.districtId === id ? (id === null ? SIGN_OPACITY : 1) : DIMMED;
      const f = id === null ? undefined : frames.get(id);
      ring.visible = !!f;
      if (f) {
        ring.position.set(f.x, f.baseY + 0.3, f.z);
        ring.scale.setScalar(f.size * 0.8);
      }
    },
    setVisible(visible) {
      labels.visible = visible;
      poles.visible = visible;
    },
    dispose() {
      for (const s of sprites) {
        (s.material as SpriteMaterial).map?.dispose();
        (s.material as SpriteMaterial).dispose();
      }
      poleGeometry.dispose();
      poleMaterial.dispose();
      ring.geometry.dispose();
      (ring.material as MeshBasicMaterial).dispose();
    },
  };
}
