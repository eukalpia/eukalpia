import { Vector3 } from 'three';
import { DISTRICTS } from '../src/content/districts';
import { buildCity } from '../src/world/buildings/geometry';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { focusPose, landmarkFrames } from '../src/world/landmarks';

const layout = createLayout(DEFAULT_SEED, DISTRICTS);
const frames = landmarkFrames(buildCity(layout, DISTRICTS).specs);

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
    const { position, target } = focusPose(f);
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
