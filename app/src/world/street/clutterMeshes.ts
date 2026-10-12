import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { SunRig } from '../../engine/lighting/sun';
import { signalState, WORDS, type ClutterPlan, type Light } from './clutter';

type V3 = [number, number, number];

/** Collects quads in a local frame (origin, yaw) with normals, UVs and vertex colours. */
class LocalBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private o: V3 = [0, 0, 0];
  private c = 1;
  private s = 0;
  color = new Color(1, 1, 1);

  frame(x: number, y: number, z: number, rotY: number) {
    this.o = [x, y, z];
    this.c = Math.cos(rotY);
    this.s = Math.sin(rotY);
    return this;
  }

  /** Local +x maps to (cos, 0, −sin) and local +z to (sin, 0, cos), as Object3D.rotation.y does. */
  private world(p: V3): V3 {
    return [this.o[0] + p[0] * this.c + p[2] * this.s, this.o[1] + p[1], this.o[2] - p[0] * this.s + p[2] * this.c];
  }

  quad(a: V3, b: V3, c: V3, d: V3, n: V3, uv: [number, number, number, number, number, number, number, number]) {
    const i = this.pos.length / 3;
    const wn: V3 = [n[0] * this.c + n[2] * this.s, n[1], -n[0] * this.s + n[2] * this.c];
    [a, b, c, d].forEach((p, k) => {
      this.pos.push(...this.world(p));
      this.nor.push(...wn);
      this.uv.push(uv[k * 2], uv[k * 2 + 1]);
      this.col.push(this.color.r, this.color.g, this.color.b);
    });
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const u = [0, 0, 1, 0, 1, 1, 0, 1] as [number, number, number, number, number, number, number, number];
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], u);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], u);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], u);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], u);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], u);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], u);
  }

  cylinder(y0: number, y1: number, r: number, segments = 10) {
    for (let k = 0; k < segments; k++) {
      const a0 = (k / segments) * Math.PI * 2;
      const a1 = ((k + 1) / segments) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p = (a: number, y: number): V3 => [Math.sin(a) * r, y, Math.cos(a) * r];
      this.quad(p(a0, y0), p(a1, y0), p(a1, y1), p(a0, y1), [Math.sin(am), 0, Math.cos(am)], [0, 0, 1, 0, 1, 1, 0, 1]);
    }
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    const n = this.pos.length / 3;
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

const POLE_HEIGHT = 3.4;
const HEAD_Y = 2.85;
const HEAD_OUT = 0.2;
const LENS_STEP = 0.29;
const LENS_COLORS: Record<Light, [number, number, number]> = {
  red: [1, 0.08, 0.03],
  amber: [1, 0.45, 0.02],
  green: [0.1, 1, 0.55],
};
const LIGHTS: Light[] = ['red', 'amber', 'green'];
const ROW_W = 1024;
const ROW_H = 80;
/** Fraction of an atlas row the lettering may use, so a short blade sign still shows the whole word. */
const TEXT_SPAN = 0.3;

function wordAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ROW_W;
  canvas.height = ROW_H * WORDS.length;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#0c0d10';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  WORDS.forEach((word, i) => {
    const cy = i * ROW_H + ROW_H / 2;
    let size = 50;
    g.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
    const max = ROW_W * TEXT_SPAN * 0.86;
    const w = g.measureText(word).width;
    if (w > max) size = Math.floor((size * max) / w);
    g.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
    // A soft halo under the lettering reads as neon tubing at night.
    g.shadowColor = 'rgba(255,255,255,0.55)';
    g.shadowBlur = 10;
    g.fillStyle = '#ffffff';
    g.fillText(word, ROW_W / 2, cy + 2);
    g.shadowBlur = 0;
  });
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export interface ClutterMeshes {
  group: Group;
  /** Signal lamps follow the shared street clock. */
  update(t: number): void;
  setNight(night: boolean): void;
  dispose(): void;
}

export function createClutterMeshes(plan: ClutterPlan, ctx: { sun: SunRig }): ClutterMeshes {
  const group = new Group();
  group.name = 'StreetClutter';

  // Signal poles: a mast, two heads with backplates and hoods, one facing each street.
  const steel = new LocalBuilder();
  for (const p of plan.signals) {
    steel.frame(p.x, p.y, p.z, 0);
    steel.cylinder(0, POLE_HEIGHT, 0.075);
    steel.box(-0.16, 0, -0.16, 0.16, 0.08, 0.16);
    steel.box(-0.09, POLE_HEIGHT, -0.09, 0.09, POLE_HEIGHT + 0.05, 0.09);
    for (const rotY of [p.sz > 0 ? 0 : Math.PI, p.sx > 0 ? Math.PI / 2 : -Math.PI / 2]) {
      steel.frame(p.x, p.y + HEAD_Y, p.z, rotY);
      steel.box(-0.06, -0.08, 0.06, 0.06, 0.08, HEAD_OUT - 0.1);
      steel.box(-0.17, -0.48, HEAD_OUT - 0.12, 0.17, 0.48, HEAD_OUT + 0.12);
      steel.box(-0.27, -0.58, HEAD_OUT - 0.14, 0.27, 0.58, HEAD_OUT - 0.12);
      for (const k of [-1, 0, 1])
        steel.box(-0.12, k * LENS_STEP + 0.1, HEAD_OUT + 0.12, 0.12, k * LENS_STEP + 0.12, HEAD_OUT + 0.3);
    }
  }
  const steelGeo = steel.build();
  const steelMat = new MeshStandardMaterial({ color: 0x24282a, roughness: 0.55, metalness: 0.6 });
  ctx.sun.setupMaterial(steelMat);
  const poles = new Mesh(steelGeo, steelMat);
  poles.castShadow = true;
  poles.receiveShadow = true;
  poles.name = 'signals';

  // Lenses: three per head, coloured per instance; lit ones go above the bloom threshold.
  const lensGeo = new CircleGeometry(0.105, 16);
  const lensMat = new MeshBasicMaterial({ color: 0xffffff });
  const lensCount = plan.signals.length * 6;
  const lenses = new InstancedMesh(lensGeo, lensMat, lensCount);
  lenses.name = 'signal-lenses';
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const one = new Vector3(1, 1, 1);
  plan.signals.forEach((p, i) => {
    const heads: [number, number, number][] = [
      [p.sz > 0 ? 0 : Math.PI, 0, p.sz],
      [p.sx > 0 ? Math.PI / 2 : -Math.PI / 2, p.sx, 0],
    ];
    heads.forEach(([rotY, nx, nz], h) => {
      LIGHTS.forEach((_, k) => {
        const out = HEAD_OUT + 0.125;
        pos.set(p.x + nx * out, p.y + HEAD_Y + (1 - k) * LENS_STEP, p.z + nz * out);
        m.compose(pos, q.setFromAxisAngle(up, rotY), one);
        lenses.setMatrixAt(i * 6 + h * 3 + k, m);
      });
    });
  });
  const lensColor = new Color();
  let litGain = 5;
  const shown = plan.crossings.map(() => '');
  function updateLenses(t: number, force = false) {
    let changed = false;
    plan.crossings.forEach((c, ci) => {
      const s = signalState(c, t);
      const key = `${s.ns}${s.ew}`;
      if (!force && shown[ci] === key) return;
      shown[ci] = key;
      changed = true;
    });
    if (!changed) return;
    plan.signals.forEach((p, i) => {
      const s = signalState(plan.crossings[p.crossing], t);
      [s.ns, s.ew].forEach((state, h) => {
        LIGHTS.forEach((light, k) => {
          const [r, g, b] = LENS_COLORS[light];
          const gain = state === light ? litGain : 0.035;
          lenses.setColorAt(i * 6 + h * 3 + k, lensColor.setRGB(r * gain, g * gain, b * gain));
        });
      });
    });
    if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
  }
  updateLenses(0, true);
  lenses.computeBoundingSphere();

  // Awnings: a sloped canopy with a valance, striped or plain.
  const fabric = new LocalBuilder();
  const cream = new Color(0xe9e2d0);
  const tint = new Color();
  for (const a of plan.awnings) {
    fabric.frame(a.x, a.y, a.z, a.rotY);
    const drop = a.depth * 0.45;
    const len = Math.hypot(a.depth, drop);
    const n: V3 = [0, a.depth / len, drop / len];
    const stripes = a.striped ? Math.max(2, Math.round(a.width / 0.32)) : 1;
    for (let k = 0; k < stripes; k++) {
      const x0 = -a.width / 2 + (a.width * k) / stripes;
      const x1 = -a.width / 2 + (a.width * (k + 1)) / stripes;
      fabric.color.copy(a.striped && k % 2 === 1 ? cream : tint.set(a.color));
      fabric.quad([x0, 0, 0], [x0, -drop, a.depth], [x1, -drop, a.depth], [x1, 0, 0], n, [0, 0, 0, 1, 1, 1, 1, 0]);
      fabric.quad(
        [x0, -drop - 0.24, a.depth],
        [x1, -drop - 0.24, a.depth],
        [x1, -drop, a.depth],
        [x0, -drop, a.depth],
        [0, 0, 1],
        [0, 0, 1, 0, 1, 1, 0, 1],
      );
    }
    // Side cheeks.
    fabric.color.set(a.color).multiplyScalar(0.8);
    for (const sx of [-1, 1]) {
      const x = (sx * a.width) / 2;
      const ring: V3[] = [
        [x, 0, 0],
        [x, -0.24, 0],
        [x, -drop - 0.24, a.depth],
        [x, -drop, a.depth],
      ];
      if (sx > 0) ring.reverse();
      fabric.quad(ring[0], ring[1], ring[2], ring[3], [sx, 0, 0], [0, 0, 0, 1, 1, 1, 1, 0]);
    }
  }
  const fabricGeo = fabric.build();
  const fabricMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: DoubleSide });
  ctx.sun.setupMaterial(fabricMat);
  const awnings = new Mesh(fabricGeo, fabricMat);
  awnings.castShadow = true;
  awnings.receiveShadow = true;
  awnings.name = 'awnings';

  // Signs: lettering from the word atlas, tinted per sign; blade signs get a frame and a bracket.
  const letters = new LocalBuilder();
  const frames = new LocalBuilder();
  const rows = WORDS.length;
  for (const s of plan.signs) {
    letters.color.set(s.color);
    const span = Math.min(1, (s.width / s.height) * (ROW_H / ROW_W));
    const u0 = 0.5 - span / 2;
    const u1 = 0.5 + span / 2;
    const v0 = 1 - (s.word + 1) / rows;
    const v1 = 1 - s.word / rows;
    const hw = s.width / 2;
    const hh = s.height / 2;
    letters.frame(s.x, s.y, s.z, s.rotY);
    if (s.kind === 'fascia') {
      letters.quad([-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0], [0, 0, 1], [u0, v0, u1, v0, u1, v1, u0, v1]);
    } else {
      letters.quad(
        [-hw, -hh, 0.045],
        [hw, -hh, 0.045],
        [hw, hh, 0.045],
        [-hw, hh, 0.045],
        [0, 0, 1],
        [u0, v0, u1, v0, u1, v1, u0, v1],
      );
      letters.quad(
        [hw, -hh, -0.045],
        [-hw, -hh, -0.045],
        [-hw, hh, -0.045],
        [hw, hh, -0.045],
        [0, 0, -1],
        [u0, v0, u1, v0, u1, v1, u0, v1],
      );
      frames.frame(s.x, s.y, s.z, s.rotY);
      frames.box(-hw - 0.05, -hh - 0.05, -0.04, hw + 0.05, hh + 0.05, 0.04);
      // Bracket along the top, back to the wall (local +x points at the wall).
      frames.box(-hw, hh + 0.05, -0.025, hw + 0.27, hh + 0.1, 0.025);
    }
  }
  const atlas = wordAtlas();
  const signGeo = letters.build();
  const signMat = new MeshStandardMaterial({
    map: atlas,
    emissiveMap: atlas,
    emissive: 0xffffff,
    emissiveIntensity: 0.12,
    vertexColors: true,
    roughness: 0.45,
    metalness: 0.1,
  });
  signMat.onBeforeCompile = shader => {
    // Neon takes the sign's colour too, not only the painted letters.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif',
    );
  };
  ctx.sun.setupMaterial(signMat);
  const signs = new Mesh(signGeo, signMat);
  signs.receiveShadow = true;
  signs.name = 'signs';
  const frameGeo = frames.build();
  const frameMesh = new Mesh(frameGeo, steelMat);
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  frameMesh.name = 'sign-frames';

  group.add(poles, lenses, awnings, signs, frameMesh);
  for (const mesh of [poles, awnings, signs, frameMesh]) mesh.matrixAutoUpdate = false;

  let lastT = 0;
  return {
    group,
    update(t) {
      lastT = t;
      updateLenses(t);
    },
    setNight(night) {
      litGain = night ? 3.2 : 5;
      signMat.emissiveIntensity = night ? 3.6 : 0.12;
      updateLenses(lastT, true);
    },
    dispose() {
      for (const g of [steelGeo, lensGeo, fabricGeo, signGeo, frameGeo]) g.dispose();
      for (const mat of [steelMat, lensMat, fabricMat, signMat]) mat.dispose();
      atlas.dispose();
    },
  };
}
