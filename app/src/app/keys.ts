import type { Sector } from './url';

/** v1 matches event.key, so B and A are case-sensitive. */
export const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
] as const;

export interface KeyContext {
  panelOpen: boolean;
  walking: boolean;
  /** Free flight with the canvas focused: the keys fly. */
  flyOnCanvas: boolean;
  tracing: boolean;
  sector: Sector;
}

interface KeyEventLike {
  key: string;
  target: EventTarget | { tagName?: string } | null;
  preventDefault(): void;
}

const typing = (t: KeyEventLike['target']) => {
  const tag = (t as { tagName?: string } | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
};

/** Street level toggles with the overview; from floor −1 E and Help both go to street level. */
export const otherSector = (s: Sector): Sector => (s === 'street' ? 'overview' : 'street');

/** v1's global keys (inventory 3.2): Konami anywhere, D / E / Space only when nothing else wants them. */
export function createKeys(o: {
  context(): KeyContext;
  projects(): void;
  go(sector: Sector): void;
  pause(): void;
  override(): void;
}) {
  let step = 0;
  return {
    down(e: KeyEventLike) {
      if (typing(e.target)) return;
      step = e.key === KONAMI[step] ? step + 1 : e.key === KONAMI[0] ? 1 : 0;
      if (step === KONAMI.length) {
        step = 0;
        o.override();
      }
      const c = o.context();
      if (c.panelOpen || c.walking || c.flyOnCanvas) return;
      const key = e.key.toLowerCase();
      if (key === 'd') o.projects();
      else if (key === 'e') o.go(otherSector(c.sector));
      else if (e.key === ' ' && (e.target as { tagName?: string } | null)?.tagName !== 'BUTTON') {
        e.preventDefault();
        if (!c.tracing) o.pause();
      }
    },
  };
}
