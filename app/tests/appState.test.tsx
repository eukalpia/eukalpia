// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import type { Sector } from '../src/app/url';

let resolveWorld: (w: unknown) => void = () => {};
vi.mock('../src/engine/world', () => ({
  createWorld: () => new Promise(r => (resolveWorld = r)),
}));

import { App } from '../src/app/App';
import { DISTRICTS } from '../src/content/districts';

function recordingWorld() {
  const calls: unknown[][] = [];
  let tourListener: (on: boolean) => void = () => {};
  let hoverListener: (label: string | null) => void = () => {};
  let pickListener: (target: unknown) => void = () => {};
  const rec =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return ret;
    };
  const world = {
    setTime: rec('setTime'),
    resize() {},
    dispose() {},
    setMode: rec('setMode', true),
    onModeChange() {},
    walkState: () => 'ready',
    liftStatus: () => ({ label: 'Ride to LMS roof', available: true }),
    setSector: rec('setSector', true),
    focusDistrict: rec('focusDistrict'),
    setPaused: rec('setPaused'),
    setTour: rec('setTour'),
    onTourChange: (fn: (on: boolean) => void) => (tourListener = fn),
    setFly: rec('setFly'),
    setFlyInput() {},
    setPixelated: rec('setPixelated'),
    onHover: (fn: typeof hoverListener) => (hoverListener = fn),
    onPick: (fn: typeof pickListener) => (pickListener = fn),
    followVehicle: rec('followVehicle'),
    walkControls: {
      setStick: rec('setStick'),
      setRun: rec('setRun'),
      jump: rec('jump'),
      toggleView: rec('toggleView'),
      firstPerson: () => false,
      inspect: rec('inspect'),
      lift: rec('lift'),
    },
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
    calls,
    endTour: () => tourListener(false),
    hover: (label: string | null) => hoverListener(label),
    pick: (target: unknown) => pickListener(target),
    called: (name: string) => calls.filter(c => c[0] === name),
  };
}

async function mount(props: { sector?: Sector; reducedMotion?: boolean } = {}) {
  const r = recordingWorld();
  render(
    <App quality="high" initialTime="day" reducedMotion={props.reducedMotion ?? true} webgl2 sector={props.sector} />,
  );
  await act(async () => resolveWorld(r.world));
  return r;
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

test('Orbit and E navigate the world and write ?sector=', async () => {
  const r = await mount();
  fireEvent.keyDown(window, { key: 'e' });
  expect(r.called('setSector').at(-1)).toEqual(['setSector', 'street']);
  expect(window.location.search).toBe('?sector=street');
  fireEvent.click(screen.getByRole('button', { name: 'Return to orbit' }));
  expect(r.called('setSector').at(-1)).toEqual(['setSector', 'overview']);
  expect(window.location.search).toBe('?sector=overview');
});

test('D opens Projects; choosing a district flies the camera there', async () => {
  const r = await mount();
  fireEvent.keyDown(window, { key: 'd' });
  fireEvent.click(screen.getByText('University LMS'));
  const lms = DISTRICTS.find(d => d.name === 'lms.turin.uz')!;
  expect(r.called('focusDistrict')).toEqual([['focusDistrict', lms.id]]);
});

test('pause reaches the world; under reduced motion the city starts paused and Resume runs it', async () => {
  const r = await mount();
  expect(r.called('setPaused').at(-1)).toEqual(['setPaused', true]);
  fireEvent.click(screen.getByRole('button', { name: 'Resume motion' }));
  expect(r.called('setPaused').at(-1)).toEqual(['setPaused', false]);
  fireEvent.keyDown(window, { key: ' ' });
  expect(r.called('setPaused').at(-1)).toEqual(['setPaused', true]);
});

test('Share copies a link with only the sector, then says so for 2.5 s', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  window.history.replaceState(null, '', '/eukalpia/?quality=low');
  await mount();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share this location' })));
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/eukalpia/?sector=overview`);
  expect(screen.getByRole('button', { name: 'Location copied' })).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(2600));
  expect(screen.getByRole('button', { name: 'Share this location' })).toBeTruthy();
  vi.useRealTimers();
});

test('when the clipboard refuses, the link shows in a toast', async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
  await mount();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share this location' })));
  expect(screen.getByRole('status').textContent).toMatch(/^Share this location: http.*\?sector=overview$/);
});

test('the tour: Help starts it, a drag in the world ends it and the guidance follows', async () => {
  const r = await mount();
  expect(screen.getByText('DRAG TO ORBIT · SCROLL TO EXPLORE')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Controls and help' }));
  fireEvent.click(screen.getByRole('button', { name: /Start cinematic tour/ }));
  expect(r.called('setTour').at(-1)).toEqual(['setTour', true]);
  expect(screen.getByText('CINEMATIC TOUR · DRAG TO EXPLORE')).toBeTruthy();
  await act(async () => r.endTour());
  expect(screen.getByText('DRAG TO ORBIT · SCROLL TO EXPLORE')).toBeTruthy();
});

test('the tour starts after the move to the overview: the world ends a tour whenever the camera flies', async () => {
  const r = await mount({ sector: 'street' });
  fireEvent.click(screen.getByRole('button', { name: 'Controls and help' }));
  fireEvent.click(screen.getByRole('button', { name: /Start cinematic tour/ }));
  const last = (name: string) => r.calls.findLastIndex(c => c[0] === name);
  expect(r.calls[last('setSector')]).toEqual(['setSector', 'overview']);
  expect(r.calls[last('setTour')]).toEqual(['setTour', true]);
  expect(last('setTour')).toBeGreaterThan(last('setSector'));
});

test('free flight: the toast only when it starts; pixel vision reaches the world and the page', async () => {
  const r = await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Controls and help' }));
  fireEvent.click(screen.getByRole('button', { name: /Enable free flight/ }));
  expect(r.called('setFly').at(-1)).toEqual(['setFly', true]);
  expect(screen.getByRole('status').textContent).toBe(
    'FREE FLIGHT · Click the city, then W A S D to move. Q / E change altitude. Drag to turn.',
  );
  expect(screen.getByText('W A S D TO FLY · Q / E ALTITUDE · DRAG TO LOOK')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Controls and help' }));
  fireEvent.click(screen.getByRole('button', { name: /Pixel vision/ }));
  expect(r.called('setPixelated').at(-1)).toEqual(['setPixelated', true]);
  expect(document.querySelector('main')!.classList.contains('pixelated')).toBe(true);
});

test('the maintenance door goes to floor −1', async () => {
  const r = await mount();
  fireEvent.click(screen.getByRole('button', { name: "About Umaraliev Ravshan Rustamjon O'gli" }));
  fireEvent.click(screen.getByRole('button', { name: /MAINTENANCE/ }));
  expect(r.called('setSector').at(-1)).toEqual(['setSector', 'underworld']);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('BELOW THE SURFACE')).toBeTruthy();
});

test('hovering names what is under the pointer; leaving restores the hint', async () => {
  const r = await mount();
  await act(async () => r.hover('University LMS'));
  expect(screen.getByText('University LMS')).toBeTruthy();
  expect(screen.queryByText('DRAG TO ORBIT · SCROLL TO EXPLORE')).toBeNull();
  await act(async () => r.hover(null));
  expect(screen.getByText('DRAG TO ORBIT · SCROLL TO EXPLORE')).toBeTruthy();
});

test('clicking a building opens its card and flies there; clicking the air taxi chases it', async () => {
  const r = await mount();
  const lms = DISTRICTS.find(d => d.name === 'lms.turin.uz')!;
  await act(async () => r.pick({ kind: 'district', id: lms.id }));
  expect(screen.getByRole('complementary', { name: 'University LMS' })).toBeTruthy();
  expect(r.called('focusDistrict')).toEqual([['focusDistrict', lms.id]]);
  await act(async () => r.pick({ kind: 'vehicle' }));
  expect(r.called('followVehicle')).toHaveLength(1);
});

test("walking shows v1's walk panel in place of the dock; its buttons drive UR-01 and Exit returns to orbit", async () => {
  vi.useFakeTimers();
  const r = await mount();
  expect(screen.queryByRole('region', { name: 'Character controls' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Walk through the city' }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(screen.getByRole('region', { name: 'Character controls' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ride to LMS roof' }));
  fireEvent.click(screen.getByRole('button', { name: 'Switch to first person' }));
  fireEvent.click(screen.getByRole('button', { name: 'Switch to running' }));
  fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect what you are looking at' }));
  expect(['lift', 'toggleView', 'jump', 'inspect'].map(n => r.called(n).length)).toEqual([1, 1, 1, 1]);
  expect(r.called('setRun').at(-1)).toEqual(['setRun', true]);
  fireEvent.click(screen.getByRole('button', { name: 'Leave walking mode' }));
  expect(r.called('setSector').at(-1)).toEqual(['setSector', 'overview']);
  vi.useRealTimers();
});
