import { BufferAttribute, BufferGeometry, Color } from 'three';

export type V3 = [number, number, number];

/** Collects quads in a local frame (origin, yaw) with normals, UVs and vertex colours. */
export class LocalBuilder {
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
