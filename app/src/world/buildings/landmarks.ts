import type { District } from '../../content/districts';
import type { Lot } from '../layout';
import { range, type Rng } from '../rng';
import { massBuilding, type BuildingSpec } from './massing';

export const MONOLITH_HEIGHT = 320;

/** Each project gets a recognisable tower: production platforms tall, repositories mid-rise. */
export function planLandmark(lot: Lot, district: District, baseY: number, rng: Rng): BuildingSpec {
  if (district.research) {
    return massBuilding(lot, baseY, rng, {
      style: 'glass',
      height: range(rng, 140, 170),
      setbackAt: [0.55],
      crown: 'mast',
      districtId: district.id,
      freeHeight: true,
    });
  }
  if (district.production) {
    const deco = Math.abs(district.id) % 2 === 0;
    return massBuilding(lot, baseY, rng, {
      style: deco ? 'artdeco' : 'glass',
      height: range(rng, 120, 200),
      setbackAt: deco ? [0.42, 0.7, 0.88] : [0.6],
      crown: deco ? 'stepped' : 'mast',
      districtId: district.id,
      freeHeight: true,
    });
  }
  return massBuilding(lot, baseY, rng, {
    style: Math.abs(district.id) % 2 === 0 ? 'modernist' : 'glass',
    height: range(rng, 60, 110),
    setbackAt: [0.7],
    crown: 'flat',
    districtId: district.id,
    freeHeight: true,
  });
}

/** The tallest tower: art deco, four setbacks, a spire. Exactly 320 m to the roof. */
export function planMonolith(lot: Lot, baseY: number, rng: Rng): BuildingSpec {
  const spec = massBuilding(lot, baseY, rng, {
    style: 'artdeco',
    height: MONOLITH_HEIGHT,
    floorHeight: 4,
    setbackAt: [0.4, 0.68, 0.86],
    crown: 'spire',
    freeHeight: true,
  });
  return spec;
}
