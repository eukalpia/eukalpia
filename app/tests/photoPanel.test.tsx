// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { PhotoPanel } from '../src/app/PhotoPanel';
import type { World } from '../src/engine/world';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fakeWorld(over: Partial<World['photo']> = {}) {
  let status: ReturnType<World['photo']['status']> = null;
  const errors: ((m: string) => void)[] = [];
  const photo: World['photo'] = {
    enter: vi.fn(async () => {
      status = { phase: 'tracing', samples: 37.4, target: 256 };
      return { ok: true } as const;
    }),
    exit: vi.fn(() => {
      status = null;
    }),
    status: () => status,
    onError: fn => void errors.push(fn),
    focusAt: vi.fn(),
    setAperture: vi.fn(),
    save: vi.fn(async () => new Blob(['png'], { type: 'image/png' })),
    ...over,
  };
  return { world: { photo } as unknown as World, photo, fail: (m: string) => errors.forEach(fn => fn(m)) };
}

test('entering shows progress and Exit returns', async () => {
  vi.useFakeTimers();
  const { world, photo } = fakeWorld();
  render(<PhotoPanel world={world} canvas={null} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open photo mode' })));
  await act(async () => vi.advanceTimersByTime(300));
  expect(screen.getByText('TRACING · 37 / 256')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  expect(photo.exit).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Open photo mode' })).toBeTruthy();
});

test('Escape leaves photo mode', async () => {
  const { world, photo } = fakeWorld();
  render(<PhotoPanel world={world} canvas={null} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open photo mode' })));
  fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
  expect(photo.exit).toHaveBeenCalled();
});

test('a refusal is announced and photo mode closes', async () => {
  const message =
    'Photo mode needs floating-point render targets (EXT_color_buffer_float), which this GPU does not offer.';
  const { world } = fakeWorld({ enter: async () => ({ ok: false, message }) });
  render(<PhotoPanel world={world} canvas={null} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open photo mode' })));
  expect(screen.getByRole('alert').textContent).toBe(message);
  expect(screen.getByRole('button', { name: 'Open photo mode' })).toBeTruthy();
});

test('a later failure (lost context) also closes and explains', async () => {
  const { world, fail } = fakeWorld();
  render(<PhotoPanel world={world} canvas={null} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open photo mode' })));
  await act(async () => fail('Photo mode lost the graphics context. The city is back in normal mode.'));
  expect(screen.getByRole('alert').textContent).toContain('lost the graphics context');
  expect(screen.getByRole('button', { name: 'Open photo mode' })).toBeTruthy();
});

test('Save frame downloads a png with a sortable name', async () => {
  const { world, photo } = fakeWorld();
  const clicks: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.download);
  });
  URL.createObjectURL = vi.fn(() => 'blob:frame');
  URL.revokeObjectURL = vi.fn();
  render(<PhotoPanel world={world} canvas={null} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open photo mode' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save frame' })));
  expect(photo.save).toHaveBeenCalled();
  expect(clicks).toHaveLength(1);
  expect(clicks[0]).toMatch(/^eukalpia-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.png$/);
  click.mockRestore();
});

test('the aperture slider steps through f-stops, and a click on the city focuses there', async () => {
  const { world, photo } = fakeWorld();
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 }) as DOMRect;
  render(<PhotoPanel world={world} canvas={canvas} />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open photo mode' })));
  fireEvent.change(screen.getByRole('slider', { name: 'Aperture' }), { target: { value: '2' } });
  expect(photo.setAperture).toHaveBeenLastCalledWith(2.8);
  expect(screen.getByText('f/2.8')).toBeTruthy();
  fireEvent.click(canvas, { clientX: 150, clientY: 25 });
  expect(photo.focusAt).toHaveBeenLastCalledWith(0.5, 0.5);
});
