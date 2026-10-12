import { Box3, Ray, Vector3 } from 'three';
import { isClick, pickNearest, type Pickable } from '../src/world/picking';

const box = (x: number, z: number, h: number) => new Box3(new Vector3(x - 5, 0, z - 5), new Vector3(x + 5, h, z + 5));

test('the nearest box along the ray wins', () => {
  const items: Pickable[] = [
    { box: box(0, -100, 50), target: { kind: 'district', id: 1 }, label: 'far' },
    { box: box(0, -40, 50), target: { kind: 'district', id: 2 }, label: 'near' },
  ];
  const ray = new Ray(new Vector3(0, 20, 0), new Vector3(0, 0, -1));
  expect(pickNearest(ray, items)?.label).toBe('near');
  expect(pickNearest(new Ray(new Vector3(0, 20, 0), new Vector3(0, 0, 1)), items)).toBeNull();
});

test('boxes can move: a function box is read at pick time', () => {
  let x = 0;
  const items: Pickable[] = [{ box: () => box(x, -40, 10), target: { kind: 'vehicle' }, label: 'UR-07' }];
  const ray = new Ray(new Vector3(0, 5, 0), new Vector3(0, 0, -1));
  expect(pickNearest(ray, items)?.label).toBe('UR-07');
  x = 100;
  expect(pickNearest(ray, items)).toBeNull();
});

test('a click moves at most 5 px between press and release; more is a drag', () => {
  expect(isClick({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true);
  expect(isClick({ x: 10, y: 10 }, { x: 16, y: 10 })).toBe(false);
});
