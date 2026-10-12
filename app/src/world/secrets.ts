import {
  Box3,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Vector3,
  type Material,
} from 'three';
import { DISTRICTS } from '../content/districts';
import type { SignalId } from '../content/signals';
import { MeshBuilder } from './buildings/geometry';
import type { BuildingSpec } from './buildings/massing';
import type { CityLayout } from './layout';
import type { Pickable } from './picking';

/** v1's hover labels for the hidden objects (inventory 1.2). */
export const SECRET_LABELS: Record<SignalId, string> = {
  cat: 'A very suspicious cat',
  monolith: 'The monolith · listen closely',
  override: 'An old-school signal repeater',
  underworld: 'An unmarked elevator · -1',
  cipher: '65 75 6b 61 6c 70 69 61 · a familiar transmission',
  ghost: 'Someone is still awake',
};

/** Every roof has a parapet this high (buildings/geometry.ts); the cat walks on it. */
const PARAPET_HEIGHT = 1.1;

export interface SecretPlan {
  id: SignalId;
  /** Where the object stands (its base, or the window's centre). */
  position: Vector3;
  /** The hover and click box, generous so small things can be found. */
  box: Box3;
}

const around = (p: Vector3, w: number, h: number, lift = h / 2) =>
  new Box3().setFromCenterAndSize(new Vector3(p.x, p.y + lift, p.z), new Vector3(w, h, w));

/** Places v1's six hidden objects in the v2 city, next to the same landmarks. */
export function planSecrets(layout: CityLayout, specs: readonly BuildingSpec[]): SecretPlan[] {
  const landmark = (name: string) => {
    const id = DISTRICTS.find(d => d.name === name)!.id;
    return specs.find(s => s.districtId === id)!;
  };
  const plans: SecretPlan[] = [];

  // A cat walking the south parapet of the Admissions roof (the 1.1 m, 0.3 m-thick wall every roof has).
  const admissions = landmark('qabul.turin.uz');
  const roof = admissions.tiers[admissions.tiers.length - 1];
  const cat = new Vector3(roof.cx + roof.width * 0.15, roof.y1 + PARAPET_HEIGHT, roof.cz + roof.depth / 2 - 0.15);
  plans.push({ id: 'cat', position: cat, box: around(cat, 6, 4, 1) });

  // The monolith: the tallest tower, knocked on from anywhere.
  const monolith = specs.find(s => s.lotId.endsWith('monolith'))!;
  const box = new Box3();
  for (const t of monolith.tiers)
    box.union(
      new Box3(
        new Vector3(t.cx - t.width / 2, t.y0, t.cz - t.depth / 2),
        new Vector3(t.cx + t.width / 2, t.y1, t.cz + t.depth / 2),
      ),
    );
  const base = monolith.tiers[0];
  plans.push({ id: 'monolith', position: new Vector3(base.cx, box.max.y, base.cz), box });

  // An unmarked elevator at the monolith's foot, just outside its east wall.
  const elevator = new Vector3(base.cx + base.width / 2 + 3, monolith.baseY, base.cz);
  plans.push({ id: 'underworld', position: elevator, box: around(elevator, 6, 6) });

  // The signal repeater and the beacon stand in the main island's parks farthest apart.
  const islandY = layout.islands[0].topY;
  const parks = layout.lots.filter(l => l.islandId === 'main' && l.role === 'park');
  let pair: [number, number] = [0, Math.min(1, parks.length - 1)];
  let far = -1;
  for (let i = 0; i < parks.length; i++)
    for (let j = i + 1; j < parks.length; j++) {
      const d = Math.hypot(parks[i].x - parks[j].x, parks[i].z - parks[j].z);
      if (d > far) [far, pair] = [d, [i, j]];
    }
  const repeater = new Vector3(parks[pair[0]].x, islandY, parks[pair[0]].z);
  const beacon = new Vector3(parks[pair[1]].x, islandY, parks[pair[1]].z);
  plans.push({ id: 'override', position: repeater, box: around(repeater, 8, 5) });
  plans.push({ id: 'cipher', position: beacon, box: around(beacon, 8, 10) });

  // A lit window on Inventar's north face, halfway up the ground block.
  const inventar = landmark('inventar.uz');
  const block = inventar.tiers[0];
  const height = Math.max(...inventar.tiers.map(t => t.y1)) - inventar.baseY;
  const y = Math.min(Math.max(inventar.baseY + height * 0.5, block.y0 + 3), block.y1 - 3);
  const ghost = new Vector3(block.cx, y, block.cz - block.depth / 2 - 0.06);
  plans.push({ id: 'ghost', position: ghost, box: new Box3().setFromCenterAndSize(ghost, new Vector3(4, 4, 4)) });
  return plans;
}

export interface Secrets {
  group: Group;
  /** What can be hovered and clicked right now (the ghost only at night). */
  pickables(): Pickable[];
  /** The city's clock (seconds): the cat paces, lights blink, the crystal turns. */
  update(t: number): void;
  setNight(night: boolean): void;
  /** After its discovery the cat walks its roof. */
  setCatFound(found: boolean): void;
  setOverride(on: boolean): void;
  setCompleted(on: boolean): void;
  dispose(): void;
}

const CROSS = { normal: 0xf5b88d, override: 0xff4937, completed: 0xb9ffd8 };

export function createSecrets(plan: readonly SecretPlan[], ctx: { setup?(m: Material): void } = {}): Secrets {
  const group = new Group();
  group.name = 'secrets';
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const mat = (color: number, emissive = 0x000000, emissiveIntensity = 0, roughness = 0.6, metalness = 0) => {
    const m = new MeshStandardMaterial({ color, emissive, emissiveIntensity, roughness, metalness });
    ctx.setup?.(m);
    materials.push(m);
    return m;
  };
  const mesh = (build: (b: MeshBuilder) => void, material: Material, name: string) => {
    const b = new MeshBuilder();
    build(b);
    const g = b.build();
    geometries.push(g);
    const m = new Mesh(g, material);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const byId = new Map(plan.map(p => [p.id, p]));

  // The cat: a small boxy figure with glowing mint eyes, facing the street.
  const catPlan = byId.get('cat')!;
  const cat = new Group();
  cat.name = 'secret-cat';
  const fur = mat(0xe2ba87, 0, 0, 0.9);
  cat.add(
    mesh(
      b => {
        b.box(-0.38, 0.12, -0.15, 0.38, 0.42, 0.15);
        b.box(0.3, 0.32, -0.15, 0.6, 0.6, 0.15);
        b.box(0.34, 0.6, -0.13, 0.42, 0.7, -0.05);
        b.box(0.34, 0.6, 0.05, 0.42, 0.7, 0.13);
        b.box(-0.6, 0.3, -0.04, -0.36, 0.38, 0.04);
        for (const [x, z] of [
          [-0.3, -0.12],
          [-0.3, 0.08],
          [0.24, -0.12],
          [0.24, 0.08],
        ])
          b.box(x, 0, z, x + 0.08, 0.12, z + 0.06);
      },
      fur,
      'cat-body',
    ),
  );
  const eyes = mat(0x0a1a12, 0xa9ffcb, 2.5);
  cat.add(
    mesh(
      b => {
        b.box(0.6, 0.46, -0.1, 0.61, 0.52, -0.04);
        b.box(0.6, 0.46, 0.04, 0.61, 0.52, 0.1);
      },
      eyes,
      'cat-eyes',
    ),
  );
  cat.position.copy(catPlan.position);
  group.add(cat);
  const catHome = catPlan.position.clone();

  // The monolith's beacon cross on its crown.
  const monolith = byId.get('monolith')!;
  const crossMaterial = mat(0x111111, CROSS.normal, 3);
  const cross = mesh(
    b => {
      b.box(-4, 0, -0.6, 4, 1.2, 0.6);
      b.box(-0.6, 0, -4, 0.6, 1.2, 4);
    },
    crossMaterial,
    'monolith-cross',
  );
  cross.position.copy(monolith.position);
  group.add(cross);

  // The old-school signal repeater: a low cabinet with four blinking lights.
  const repeaterPlan = byId.get('override')!;
  const repeater = mesh(b => b.box(-2.1, 0, -2.1, 2.1, 2.5, 2.1), mat(0x253640, 0, 0, 0.7, 0.3), 'repeater');
  repeater.position.copy(repeaterPlan.position);
  group.add(repeater);
  const lampA = mat(0x1a1a1a, 0xbd986d, 0);
  const lampB = mat(0x1a1a1a, 0x83bcac, 0);
  for (let i = 0; i < 4; i++) {
    const lamp = mesh(b => b.box(-0.18, 2.5, -0.18, 0.18, 2.8, 0.18), i % 2 ? lampB : lampA, `repeater-lamp-${i}`);
    lamp.position.copy(repeaterPlan.position).add(new Vector3(i < 2 ? -1.4 : 1.4, 0, i % 2 ? -1.4 : 1.4));
    group.add(lamp);
  }

  // The unmarked elevator: a dark booth with a warm strip.
  const elevatorPlan = byId.get('underworld')!;
  const elevator = mesh(b => b.box(-1.2, 0, -1.2, 1.2, 3.9, 1.2), mat(0x334c50, 0, 0, 0.5, 0.4), 'elevator');
  elevator.position.copy(elevatorPlan.position);
  group.add(elevator);
  const strip = mesh(b => b.box(1.2, 0.4, -0.15, 1.24, 3.5, 0.15), mat(0x221410, 0xffb182, 2), 'elevator-strip');
  strip.position.copy(elevatorPlan.position);
  group.add(strip);

  // The beacon: plinth, post and tilted dish, and a glowing crystal that turns and pulses.
  const beaconPlan = byId.get('cipher')!;
  const steel = mat(0x526773, 0, 0, 0.35, 0.8);
  const beacon = mesh(
    b => {
      b.cylinder(0, 0, 1, 7.5, 0.22, 0.18, 8);
      b.cylinder(0.5, 0, 7.2, 7.8, 1.6, 0.4, 10);
    },
    steel,
    'beacon',
  );
  beacon.position.copy(beaconPlan.position);
  group.add(beacon);
  const plinth = mesh(b => b.box(-1.5, 0, -1.5, 1.5, 1, 1.5), mat(0x354854, 0, 0, 0.8), 'beacon-plinth');
  plinth.position.copy(beaconPlan.position);
  group.add(plinth);
  const crystalGeometry = new OctahedronGeometry(0.7);
  geometries.push(crystalGeometry);
  const crystalMaterial = mat(0x0c1d18, 0x96d8ca, 3, 0.2);
  const crystal = new Mesh(crystalGeometry, crystalMaterial);
  crystal.name = 'beacon-crystal';
  crystal.position.copy(beaconPlan.position).add(new Vector3(0, 9, 0));
  group.add(crystal);

  // The ghost: one lit window on the north face, only at night.
  const ghostPlan = byId.get('ghost')!;
  const paneGeometry = new PlaneGeometry(1.0, 1.4).rotateY(Math.PI);
  geometries.push(paneGeometry);
  const pane = new Mesh(paneGeometry, mat(0x0d1412, 0xc5e5d6, 2.2, 0.3));
  pane.name = 'ghost-window';
  pane.position.copy(ghostPlan.position);
  pane.visible = false;
  group.add(pane);

  let night = false;
  let catFound = false;
  let override = false;
  let completed = false;
  const crossColor = () =>
    crossMaterial.emissive.set(override ? CROSS.override : completed ? CROSS.completed : CROSS.normal);
  // Along the ledge, three metres either way.
  const roofReach = 3;

  return {
    group,
    pickables() {
      return plan
        .filter(p => p.id !== 'ghost' || night)
        .map(p => ({ box: p.box, target: { kind: 'secret' as const, id: p.id }, label: SECRET_LABELS[p.id] }));
    },
    update(t) {
      if (catFound) {
        cat.position.set(catHome.x + Math.sin(t * 0.9) * roofReach, catHome.y, catHome.z);
        cat.rotation.y = Math.cos(t * 0.9) >= 0 ? 0 : Math.PI;
      }
      crystal.rotation.y = t * 0.8;
      crystal.scale.setScalar(1 + 0.12 * Math.sin(t * 2.4));
      const blink = Math.floor(t / 0.6) % 2 === 0;
      (lampA as MeshStandardMaterial).emissiveIntensity = blink ? 2.5 : 0.2;
      (lampB as MeshStandardMaterial).emissiveIntensity = blink ? 0.2 : 2.5;
      pane.position.y = ghostPlan.position.y + Math.sin(t * 1.3) * 0.33;
    },
    setNight(on) {
      night = on;
      pane.visible = on;
    },
    setCatFound(found) {
      catFound = found;
      if (!found) cat.position.copy(catHome);
    },
    setOverride(on) {
      override = on;
      crossColor();
    },
    setCompleted(on) {
      completed = on;
      crossColor();
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
