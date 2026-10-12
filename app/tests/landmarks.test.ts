import { Box3, Ray, Vector3 } from 'three';
import { DISTRICTS } from '../src/content/districts';
import { buildCity } from '../src/world/buildings/geometry';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { focusPose, landmarkFrames } from '../src/world/landmarks';

const layout = createLayout(DEFAULT_SEED, DISTRICTS);
const specs = buildCity(layout, DISTRICTS).specs;
const frames = landmarkFrames(specs);

test('every district has a landmark building with a real height', () => {
  expect(frames.size).toBe(DISTRICTS.length);
  for (const d of DISTRICTS) {
    const f = frames.get(d.id)!;
    expect(f, d.name).toBeTruthy();
    expect(f.top - f.baseY, d.name).toBeGreaterThan(8);
  }
});

test('focusing a district frames its building from above and outside it', () => {
  for (const f of frames.values()) {
    const { position, target } = focusPose(f, specs);
    const p = new Vector3(...position);
    const t = new Vector3(...target);
    expect(t.y).toBeGreaterThan(f.baseY);
    expect(t.y).toBeLessThan(f.top);
    expect(p.y).toBeGreaterThan(t.y);
    const distance = p.distanceTo(t);
    expect(distance).toBeGreaterThan(60);
    expect(distance).toBeLessThan(700);
    expect(Math.hypot(p.x - f.x, p.z - f.z)).toBeGreaterThan(30);
  }
});

/** Whether another building stands between the camera and a point. */
function blocked(from: Vector3, to: Vector3, own: number) {
  const ray = new Ray(from, to.clone().sub(from).normalize());
  const length = from.distanceTo(to);
  const hit = new Vector3();
  return specs.some(
    s =>
      s.districtId !== own &&
      s.tiers.some(t => {
        const box = new Box3(
          new Vector3(t.cx - t.width / 2, t.y0, t.cz - t.depth / 2),
          new Vector3(t.cx + t.width / 2, t.y1, t.cz + t.depth / 2),
        );
        return ray.intersectBox(box, hit) !== null && from.distanceTo(hit) < length;
      }),
  );
}

test('focusing a district shows its tower: no other building stands between the camera and its middle or roof', () => {
  for (const f of frames.values()) {
    const p = new Vector3(...focusPose(f, specs, f.top + 40).position);
    for (const y of [f.baseY + 0.5 * (f.top - f.baseY), f.top - 1])
      expect(blocked(p, new Vector3(f.x, y, f.z), f.districtId), `district ${f.districtId} at ${y.toFixed(0)} m`).toBe(
        false,
      );
  }
});

test('the whole tower and its sign fit the 40° view, with room to spare', () => {
  for (const f of frames.values()) {
    const labelY = f.top + 62;
    const { position, target } = focusPose(f, specs, labelY);
    const p = new Vector3(...position);
    const ahead = new Vector3(...target).sub(p).normalize();
    const angle = (y: number) => ahead.angleTo(new Vector3(f.x, y, f.z).sub(p)) * (180 / Math.PI);
    expect(angle(labelY), `district ${f.districtId} sign`).toBeLessThan(17);
    expect(angle(f.baseY), `district ${f.districtId} base`).toBeLessThan(17);
  }
});
