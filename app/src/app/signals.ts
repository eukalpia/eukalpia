import { SIGNAL_ORDER, SIGNALS, type SignalId } from '../content/signals';

export const SIGNALS_KEY = 'eukalpia:signals';
const ALL_FOUND = 'ALL SIGNALS FOUND · THE CITY REMEMBERS YOU.';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

const known = (id: unknown): id is SignalId =>
  typeof id === 'string' && (SIGNAL_ORDER as readonly string[]).includes(id);

/** The discoveries on this device, in the order they were made; anything unreadable counts as none. */
export function loadSignals(store: Store): SignalId[] {
  try {
    const raw = JSON.parse(store?.getItem(SIGNALS_KEY) ?? '[]');
    return Array.isArray(raw) ? [...new Set(raw.filter(known))] : [];
  } catch {
    return [];
  }
}

export function saveSignals(store: Store, list: readonly SignalId[]) {
  try {
    store?.setItem(SIGNALS_KEY, JSON.stringify(list));
  } catch {
    // Private browsing or a full disk: the discovery still counts for this visit.
  }
}

/** Adds a discovery; only a new one gets a toast (the sixth announces that all are found). */
export function discover(list: readonly SignalId[], id: SignalId) {
  if (list.includes(id)) return { list: [...list], isNew: false, toast: null };
  const next = [...list, id];
  return { list: next, isNew: true, toast: next.length === SIGNAL_ORDER.length ? ALL_FOUND : SIGNALS[id].message };
}
