import type { MoveInput } from './controller';

const KEYS: Record<string, string> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Space: 'jump',
};

export type InputAction = 'view' | 'inspect' | 'transit' | 'exit';
const ACTIONS: Record<string, InputAction> = { KeyV: 'view', KeyF: 'inspect', KeyL: 'transit', Escape: 'exit' };

export interface Input {
  state(): MoveInput;
  /** Consumes a queued jump press. */
  takeJump(): boolean;
  onAction(fn: (a: InputAction) => void): void;
  /** Touch joystick axes override the keyboard while non-zero. */
  setStick(x: number, y: number): void;
  setRun(run: boolean): void;
  pressJump(): void;
  clear(): void;
  dispose(): void;
}

interface KeyLike {
  code?: string;
  key?: string;
  repeat?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
  preventDefault(): void;
}

function typing(e: KeyLike) {
  const t = e.target;
  if (!t) return false;
  return t.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes((t.tagName ?? '').toUpperCase());
}

/** Keyboard (and touch stick) state for walking. Keys are cleared on blur and when the tab is hidden. */
export function createInput(target: Window): Input {
  const held = new Set<string>();
  const listeners: ((a: InputAction) => void)[] = [];
  let jumpQueued = false;
  let stick = { x: 0, y: 0 };
  let runToggle = false;

  const down = (e: KeyLike) => {
    if (typing(e)) return;
    const k = KEYS[e.code ?? ''];
    if (k) {
      held.add(k);
      if (k === 'jump' && !e.repeat) jumpQueued = true;
      e.preventDefault();
      return;
    }
    const a = ACTIONS[e.code ?? ''];
    if (a && !e.repeat) for (const fn of listeners) fn(a);
  };
  const up = (e: KeyLike) => {
    const k = KEYS[e.code ?? ''];
    if (k) held.delete(k);
  };
  const clear = () => {
    held.clear();
    jumpQueued = false;
    stick = { x: 0, y: 0 };
  };
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.hidden) clear();
  };
  target.addEventListener('keydown', down as never);
  target.addEventListener('keyup', up as never);
  target.addEventListener('blur', clear);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return {
    state() {
      const kf = (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0);
      const kr = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
      const useStick = Math.hypot(stick.x, stick.y) > 0.05;
      return {
        forward: useStick ? stick.y : kf,
        right: useStick ? stick.x : kr,
        run: held.has('run') || runToggle,
        jump: false,
      };
    },
    takeJump() {
      const j = jumpQueued;
      jumpQueued = false;
      return j;
    },
    onAction(fn) {
      listeners.push(fn);
    },
    setStick(x, y) {
      stick = { x, y };
    },
    setRun(run) {
      runToggle = run;
    },
    pressJump() {
      jumpQueued = true;
    },
    clear,
    dispose() {
      target.removeEventListener('keydown', down as never);
      target.removeEventListener('keyup', up as never);
      target.removeEventListener('blur', clear);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
