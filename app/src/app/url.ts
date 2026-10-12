export type Sector = 'overview' | 'street' | 'underworld';

/** `?sector=` as v1 understood it: street level, floor −1, or the floating-city overview. */
export function parseSector(search: string): Sector {
  const sector = new URLSearchParams(search).get('sector');
  if (sector === '-1' || sector === 'underworld') return 'underworld';
  if (sector === 'street') return 'street';
  return 'overview';
}
