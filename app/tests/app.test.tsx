// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

const setTime = vi.fn();
let resolveWorld: (w: unknown) => void = () => {};
vi.mock('../src/engine/world', () => ({
  createWorld: () => new Promise(r => (resolveWorld = r)),
}));

import { App } from '../src/app/App';

afterEach(cleanup);

test('a Day/Night click while the world loads is applied once it is ready', async () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  fireEvent.click(screen.getByRole('button', { name: 'Switch to night' }));
  await act(async () => {
    resolveWorld({ setTime, resize() {}, dispose() {} });
  });
  expect(setTime).toHaveBeenLastCalledWith('night');
  expect(screen.getByRole('button', { name: 'Switch to daylight' })).toBeTruthy();
});
