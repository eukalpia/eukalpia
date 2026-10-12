export type Sector = 'overview' | 'street' | 'underworld';

/** `?sector=` as v1 understood it: street level, floor −1, or the floating-city overview. */
export function parseSector(search: string): Sector {
  const sector = new URLSearchParams(search).get('sector');
  if (sector === '-1' || sector === 'underworld') return 'underworld';
  if (sector === 'street') return 'street';
  return 'overview';
}

const param = (s: Sector) => (s === 'underworld' ? '-1' : s);

/** The current URL with ?sector= set for this sector; other parameters and the hash stay. */
export function withSector(href: string, sector: Sector): string {
  const url = new URL(href);
  url.searchParams.set('sector', param(sector));
  return url.toString();
}

/** What Share copies: the page with only ?sector=, hash kept (v1 dropped every other parameter). */
export function shareUrl(href: string, sector: Sector): string {
  const url = new URL(href);
  url.search = '';
  url.searchParams.set('sector', param(sector));
  return url.toString();
}
