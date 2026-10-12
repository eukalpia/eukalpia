import { CanvasTexture, Sprite, type SpriteMaterial } from 'three';
import { DISTRICTS } from '../src/content/districts';
import { buildCity } from '../src/world/buildings/geometry';
import { DEFAULT_SEED, createLayout } from '../src/world/layout';
import { landmarkFrames } from '../src/world/landmarks';
import { SIGN_RISE, createSigns, placeLabels, signText } from '../src/world/signs';

const layout = createLayout(DEFAULT_SEED, DISTRICTS);
const frames = landmarkFrames(buildCity(layout, DISTRICTS).specs);
const fakeTexture = () => Object.assign(new CanvasTexture(undefined as never), { image: { width: 400, height: 128 } });

test('each district carries its repo name in capitals, as v1 painted it', () => {
  expect(signText(DISTRICTS.find(d => d.name === 'lms.turin.uz')!)).toBe('LMS.TURIN.UZ');
  expect(signText(DISTRICTS.find(d => d.name === 'EDU AI / CAU')!)).toBe('EDU AI / CAU');
});

test('sixteen signs stand above their landmarks, staggered, drawn as labels over the finished frame', () => {
  const signs = createSigns(frames, DISTRICTS, { texture: fakeTexture });
  const sprites = signs.labels.children.filter(o => (o as Sprite).isSprite) as Sprite[];
  expect(sprites).toHaveLength(16);
  DISTRICTS.forEach((d, i) => {
    const s = sprites.find(sp => sp.userData.districtId === d.id)!;
    const f = frames.get(d.id)!;
    expect(s.position.y - f.top).toBeCloseTo(SIGN_RISE[i % SIGN_RISE.length], 5);
    expect(Math.hypot(s.position.x - f.x, s.position.z - f.z)).toBeLessThan(1e-6);
    // Readable from orbit: the same size on screen at any distance, never cut by towers.
    expect((s.material as SpriteMaterial).sizeAttenuation).toBe(false);
    expect((s.material as SpriteMaterial).depthTest).toBe(false);
  });
  signs.dispose();
});

test('focusing a district dims the other signs and rings its base', () => {
  const signs = createSigns(frames, DISTRICTS, { texture: fakeTexture });
  const lms = DISTRICTS.find(d => d.name === 'lms.turin.uz')!;
  signs.setFocus(lms.id);
  const sprites = signs.labels.children.filter(o => (o as Sprite).isSprite) as Sprite[];
  for (const s of sprites)
    expect((s.material as SpriteMaterial).opacity).toBeCloseTo(s.userData.districtId === lms.id ? 1 : 0.65, 5);
  expect(signs.ring.visible).toBe(true);
  expect(signs.ring.position.x).toBeCloseTo(frames.get(lms.id)!.x, 5);
  signs.setFocus(null);
  expect(signs.ring.visible).toBe(false);
  for (const s of sprites) expect((s.material as SpriteMaterial).opacity).toBeCloseTo(0.96, 5);
  signs.dispose();
});

test('labels that would overlap on screen give way: the focused one first, then the nearest', () => {
  const rect = (x: number, y: number, priority: number) => ({ x, y, w: 0.2, h: 0.05, priority });
  // Two overlap; the third stands apart.
  expect(placeLabels([rect(0, 0, 1), rect(0.1, 0.02, 2), rect(0.6, 0.6, 3)])).toEqual([true, false, true]);
  // Priority decides, not order.
  expect(placeLabels([rect(0, 0, 5), rect(0.1, 0.02, 0)])).toEqual([false, true]);
  // Behind the camera or off screen: hidden, and they block nothing.
  expect(placeLabels([{ ...rect(0, 0, 0), behind: true }, rect(0.05, 0, 1)])).toEqual([false, true]);
});
