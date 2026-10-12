// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import type { Sector } from '../src/app/url';
import { KONAMI } from '../src/app/keys';

let resolveWorld: (w: unknown) => void = () => {};
vi.mock('../src/engine/world', () => ({
  createWorld: () => new Promise(r => (resolveWorld = r)),
}));

import { App } from '../src/app/App';

function recordingWorld() {
  const calls: unknown[][] = [];
  let pickListener: (target: unknown) => void = () => {};
  const rec =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return ret;
    };
  const world = {
    setTime() {},
    resize() {},
    dispose() {},
    setMode: rec('setMode', true),
    onModeChange() {},
    walkState: () => 'ready',
    liftStatus: () => null,
    setSector: rec('setSector', true),
    focusDistrict: rec('focusDistrict'),
    setPaused() {},
    setTour() {},
    onTourChange() {},
    setFly() {},
    setFlyInput() {},
    setPixelated() {},
    onHover() {},
    onPick: (fn: typeof pickListener) => (pickListener = fn),
    followVehicle() {},
    setOverride: rec('setOverride'),
    blackout: rec('blackout'),
    setCompleted: rec('setCompleted'),
    setCatFound: rec('setCatFound'),
    photo: {
      enter: async () => ({ ok: true }),
      exit() {},
      status: () => null,
      onError() {},
      focusAt() {},
      setAperture() {},
      save: async () => new Blob(),
    },
  };
  return {
    world,
    pick: (id: string) => pickListener({ kind: 'secret', id }),
    called: (name: string) => calls.filter(c => c[0] === name),
  };
}

async function mount(sector?: Sector) {
  const r = recordingWorld();
  render(<App quality="high" initialTime="day" reducedMotion webgl2 sector={sector} />);
  await act(async () => resolveWorld(r.world));
  return r;
}
const toast = () => screen.getByRole('status').textContent;
const main = () => document.querySelector('main')!;

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

test('finding the cat: a toast, the counter, the device remembers, and the cat starts to pace', async () => {
  const r = await mount();
  await act(async () => r.pick('cat'));
  expect(toast()).toBe('ROOFTOP RESIDENT · The city has adopted you.');
  expect(screen.getByRole('button', { name: 'Discoveries, 1 of 6 found' })).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('eukalpia:signals')!)).toEqual(['cat']);
  expect(r.called('setCatFound').at(-1)).toEqual(['setCatFound', true]);
});

test('a repeat discovery says nothing more', async () => {
  localStorage.setItem('eukalpia:signals', '["cipher"]');
  const r = await mount();
  expect(screen.getByRole('button', { name: 'Discoveries, 1 of 6 found' })).toBeTruthy();
  await act(async () => r.pick('cipher'));
  expect(toast()).toBe('');
  expect(JSON.parse(localStorage.getItem('eukalpia:signals')!)).toEqual(['cipher']);
});

test('every seventh knock on the monolith blacks the city out for 4.2 s; only the first is news', async () => {
  vi.useFakeTimers();
  const r = await mount();
  for (let i = 0; i < 6; i++) await act(async () => r.pick('monolith'));
  expect(screen.queryByText('THE HEARTBEAT CONTINUES.')).toBeNull();
  await act(async () => r.pick('monolith'));
  expect(screen.getByText('THE HEARTBEAT CONTINUES.')).toBeTruthy();
  expect(screen.getByText('SIGNAL RECOVERED / SEVEN KNOCKS')).toBeTruthy();
  expect(main().classList.contains('blackout')).toBe(true);
  expect(r.called('blackout')).toEqual([['blackout', 4200]]);
  expect(toast()).toBe('SEVEN KNOCKS · You found the heartbeat.');
  await act(async () => vi.advanceTimersByTime(4300));
  expect(main().classList.contains('blackout')).toBe(false);
  for (let i = 0; i < 7; i++) await act(async () => r.pick('monolith'));
  expect(r.called('blackout')).toHaveLength(2);
});

test('the Konami code and the repeater both accept the override', async () => {
  const r = await mount();
  for (const key of KONAMI) fireEvent.keyDown(window, { key });
  expect(main().classList.contains('override')).toBe(true);
  expect(r.called('setOverride')).toEqual([['setOverride', true]]);
  expect(toast()).toBe('OVERRIDE ACCEPTED · Welcome to the other side.');
  cleanup();
  localStorage.clear();
  const r2 = await mount();
  await act(async () => r2.pick('override'));
  expect(main().classList.contains('override')).toBe(true);
});

test('floor −1 from the address bar is a discovery, toasted once the city is there', async () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 sector="underworld" />);
  expect(toast()).toBe('');
  const r = recordingWorld();
  await act(async () => resolveWorld(r.world));
  expect(toast()).toBe('FLOOR -1 · Even floating cities have roots.');
  expect(JSON.parse(localStorage.getItem('eukalpia:signals')!)).toEqual(['underworld']);
});

test('the elevator takes you below; the beacon and the ghost are discoveries', async () => {
  const r = await mount();
  await act(async () => r.pick('underworld'));
  expect(r.called('setSector').at(-1)).toEqual(['setSector', 'underworld']);
  expect(screen.getByText('BELOW THE SURFACE')).toBeTruthy();
  await act(async () => r.pick('cipher'));
  expect(toast()).toBe('CIPHER RESOLVED · You were always meant to find this.');
  await act(async () => r.pick('ghost'));
  expect(toast()).toBe('AFTER HOURS · Some builders never really log off.');
});

test('the sixth discovery completes the city', async () => {
  localStorage.setItem('eukalpia:signals', '["cat","monolith","override","underworld","cipher"]');
  const r = await mount();
  expect(r.called('setCatFound').at(-1)).toEqual(['setCatFound', true]);
  await act(async () => r.pick('ghost'));
  expect(toast()).toBe('ALL SIGNALS FOUND · THE CITY REMEMBERS YOU.');
  expect(main().classList.contains('completed')).toBe(true);
  expect(r.called('setCompleted').at(-1)).toEqual(['setCompleted', true]);
  expect(
    screen.getByRole('button', { name: 'Discoveries, 6 of 6 found' }).classList.contains('discoveries-complete'),
  ).toBe(true);
});
