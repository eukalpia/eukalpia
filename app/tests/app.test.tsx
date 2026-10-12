// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

const setTime = vi.fn();
let resolveWorld: (w: unknown) => void = () => {};
vi.mock('../src/engine/world', () => ({
  createWorld: () => new Promise(r => (resolveWorld = r)),
}));

import { App } from '../src/app/App';

/** A world with photo mode idle, for tests that are about something else. */
const photo = {
  enter: async () => ({ ok: true }),
  exit() {},
  status: () => null,
  onError() {},
  focusAt() {},
  setAperture() {},
  save: async () => new Blob(),
};

afterEach(cleanup);

test('a Day/Night click while the world loads is applied once it is ready', async () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch to night' }));
  await act(async () => {
    resolveWorld({ setTime, resize() {}, dispose() {}, photo });
  });
  expect(setTime).toHaveBeenLastCalledWith('night');
  expect(screen.getByRole('button', { name: 'Switch to daylight' })).toBeTruthy();
});

test('while walking near the LMS lift, the hint names the L action', async () => {
  vi.useFakeTimers();
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  await act(async () => {
    resolveWorld({
      setTime,
      photo,
      resize() {},
      dispose() {},
      setMode: () => true,
      liftStatus: () => ({ available: true, label: 'Ride to LMS roof' }),
    });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Walk through the city' }));
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.getByText('L · Ride to LMS roof')).toBeTruthy();
  vi.useRealTimers();
});

test('walk mode follows the world when it changes mode on its own', async () => {
  let notify: (mode: 'orbit' | 'walk') => void = () => {};
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  await act(async () => {
    resolveWorld({
      setTime,
      photo,
      resize() {},
      dispose() {},
      setMode: () => true,
      liftStatus: () => null,
      onModeChange: (fn: typeof notify) => (notify = fn),
    });
  });
  const walking = () => document.querySelector('main')!.classList.contains('is-walking');
  fireEvent.click(screen.getByRole('button', { name: 'Walk through the city' }));
  expect(walking()).toBe(true);
  await act(async () => notify('orbit'));
  expect(walking()).toBe(false);
  await act(async () => notify('walk'));
  expect(walking()).toBe(true);
});

test('walking that is not available yet, or failed to load, says so', async () => {
  let state = 'loading';
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  await act(async () => {
    resolveWorld({ setTime, photo, resize() {}, dispose() {}, setMode: () => false, walkState: () => state });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Walk through the city' }));
  expect(screen.getByRole('status').textContent).toBe('UR-01 is still loading…');
  state = 'failed';
  fireEvent.click(screen.getByRole('button', { name: 'Walk through the city' }));
  expect(screen.getByRole('status').textContent).toBe('The exploration suit could not load. Please try Walk again.');
});
