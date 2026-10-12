// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

vi.mock('../src/engine/world', () => ({ createWorld: () => new Promise(() => {}) }));
const ambient = { setOn: vi.fn(async (_on: boolean) => {}), dispose: vi.fn() };
vi.mock('../src/app/sound', () => ({ createAmbient: () => ambient }));

import { App } from '../src/app/App';

afterEach(() => {
  cleanup();
  ambient.setOn.mockReset();
  ambient.dispose.mockReset();
});

const app = () => render(<App quality="high" initialTime="day" reducedMotion={false} webgl2 sector="overview" />);

test('the sound button plays and mutes the ambient drone, and leaving stops it', async () => {
  ambient.setOn.mockImplementation(async () => {});
  const { unmount } = app();
  await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Enable ambient sound' })));
  expect(ambient.setOn).toHaveBeenLastCalledWith(true);
  await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Mute ambient sound' })));
  expect(ambient.setOn).toHaveBeenLastCalledWith(false);
  unmount();
  expect(ambient.dispose).toHaveBeenCalled();
});

test('without audio the button turns itself back off and says the city is still open', async () => {
  ambient.setOn.mockImplementation(async on => {
    if (on) throw new Error('no audio');
  });
  app();
  await act(async () => void fireEvent.click(screen.getByRole('button', { name: 'Enable ambient sound' })));
  expect(screen.getByRole('button', { name: 'Enable ambient sound' })).toBeTruthy();
  expect(screen.getByText('Audio is unavailable in this browser. The city is still open.')).toBeTruthy();
});
