type Listener = (...args: unknown[]) => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: Record<string, unknown> = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ type, preventDefault() {}, ...event });
    },
  };
}

/** Just enough of an HTMLElement for OrbitControls to attach in Node. */
export function fakeDom() {
  const doc = fakeTarget();
  const el = Object.assign(fakeTarget(), {
    style: {} as Record<string, string>,
    ownerDocument: doc,
    clientWidth: 1280,
    clientHeight: 720,
    getRootNode: () => doc,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {},
    releasePointerCapture() {},
  });
  return el as unknown as HTMLElement & ReturnType<typeof fakeTarget>;
}

import { ShaderLib, Texture, UniformsUtils } from 'three';
import type { TextureSet } from '../src/world/buildings/facadeMaterial';

export function fakeShader() {
  return {
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
    uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms),
  } as unknown as Parameters<NonNullable<import('three').Material['onBeforeCompile']>>[0];
}

export function fakeTextures(): { concrete: TextureSet; steel: TextureSet; brick: TextureSet } {
  const set = (): TextureSet => ({ map: new Texture(), normalMap: new Texture(), armMap: new Texture() });
  return { concrete: set(), steel: set(), brick: set() };
}
