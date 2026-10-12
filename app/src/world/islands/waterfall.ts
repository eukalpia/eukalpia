import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, ShaderMaterial } from 'three';
import type { Bridge, Island } from '../layout';
import { int, range, type Rng } from '../rng';

export const WATERFALL_BOTTOM = -360;

/**
 * 2–4 ribbons that leave the island rim, arc outwards and drop into the cloud sea.
 * Attribute `aFall` = (distance down the fall in meters, across 0..1, ribbon seed).
 */
export function buildWaterfalls(
  island: Island,
  rng: Rng,
  bridges: readonly Bridge[],
): { geometry: BufferGeometry; count: number } {
  const bridgeAngles = bridges
    .filter(b => b.from === island.id || b.to === island.id)
    .map(b =>
      b.from === island.id
        ? Math.atan2(b.az - island.cz, b.ax - island.cx)
        : Math.atan2(b.bz - island.cz, b.bx - island.cx),
    );
  const count = int(rng, 2, island.id === 'main' ? 4 : 3);
  const pos: number[] = [];
  const fall: number[] = [];
  const idx: number[] = [];
  const rows = 40;
  let made = 0;
  for (let attempt = 0; made < count && attempt < 40; attempt++) {
    const a = range(rng, 0, Math.PI * 2);
    const clear = bridgeAngles.every(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 0.35);
    if (!clear) continue;
    const width = range(rng, 6, 14);
    const out = [Math.cos(a), Math.sin(a)];
    const side = [-Math.sin(a), Math.cos(a)];
    const seed = rng();
    const base = pos.length / 3;
    const top = island.topY;
    const drop = top - WATERFALL_BOTTOM;
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      // A short horizontal throw over the lip, then a near-vertical drop that widens slightly.
      const y = top - drop * t;
      const throwOut = island.radius + 2 + 26 * Math.sqrt(t) * (1 - 0.3 * t);
      const spread = width * (1 + t * 0.8);
      for (const s of [-0.5, 0.5]) {
        pos.push(
          island.cx + out[0] * throwOut + side[0] * spread * s,
          y,
          island.cz + out[1] * throwOut + side[1] * spread * s,
        );
        fall.push(drop * t, s + 0.5, seed);
      }
    }
    for (let row = 0; row < rows; row++) {
      const i = base + row * 2;
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
    made++;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('aFall', new BufferAttribute(new Float32Array(fall), 3));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  return { geometry, count: made };
}

export function createWaterfallMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'Waterfall',
    uniforms: { uTime: { value: 0 }, uLight: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec3 aFall;
      varying vec3 vFall;
      void main() {
        vFall = aFall;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uLight;
      varying vec3 vFall;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
      }
      void main() {
        float d = vFall.x;
        float across = vFall.y;
        // Streaks stretch as the water accelerates.
        vec2 p = vec2(across * 14.0 + vFall.z * 50.0, d * 0.05 - uTime * 1.6);
        float streak = n(p * vec2(1.0, 4.0)) * 0.6 + n(p * vec2(2.3, 9.0)) * 0.4;
        float edge = smoothstep(0.0, 0.18, across) * smoothstep(1.0, 0.82, across);
        float thin = mix(1.0, 0.45, smoothstep(40.0, 320.0, d));
        float alpha = edge * thin * smoothstep(0.25, 0.75, streak) * 0.85;
        vec3 col = mix(vec3(0.62, 0.72, 0.78), vec3(0.95, 0.97, 1.0), streak) * uLight;
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    premultipliedAlpha: true,
    blending: AdditiveBlending,
  });
}
