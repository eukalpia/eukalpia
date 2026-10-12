// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

let resolveWorld: (w: unknown) => void = () => {};
vi.mock('../src/engine/world', () => ({
  createWorld: () => new Promise(r => (resolveWorld = r)),
}));

import { App } from '../src/app/App';

const photo = {
  enter: async () => ({ ok: true }),
  exit() {},
  status: () => null,
  onError() {},
  focusAt() {},
  setAperture() {},
  save: async () => new Blob(),
};
const fakeWorld = () => ({
  setTime() {},
  resize() {},
  dispose() {},
  photo,
  setMode: () => true,
  onModeChange() {},
  walkState: () => 'ready',
  liftStatus: () => null,
});

afterEach(cleanup);

test('the dock has the five v1 destinations with their counters', () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  const dock = screen.getByRole('navigation', { name: 'City navigation' });
  const names = within(dock)
    .getAllByRole('button')
    .map(b => b.getAttribute('aria-label'));
  expect(names).toEqual([
    'Return to orbit',
    'Walk through the city',
    'Explore projects',
    'Discoveries, 0 of 6 found',
    'Controls and help',
  ]);
  expect(within(dock).getByRole('button', { name: 'Explore projects' }).textContent).toBe('Projects16');
  expect(within(dock).getByRole('button', { name: 'Discoveries, 0 of 6 found' }).textContent).toBe('Discoveries0/6');
});

test('Walk stays disabled and the boot message shows until the city is ready', async () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  expect(screen.getByRole('button', { name: 'Walk through the city' })).toHaveProperty('disabled', true);
  expect(screen.getByText('ASSEMBLING THE WORLD')).toBeTruthy();
  expect(document.querySelector('main')!.classList.contains('is-ready')).toBe(false);
  await act(async () => resolveWorld(fakeWorld()));
  expect(screen.getByRole('button', { name: 'Walk through the city' })).toHaveProperty('disabled', false);
  expect(screen.queryByText('ASSEMBLING THE WORLD')).toBeNull();
  expect(document.querySelector('main')!.classList.contains('is-ready')).toBe(true);
});

test('the utilities bar names each control after what it will do, with matching titles', () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  const bar = screen.getByRole('group', { name: 'World settings' });
  const buttons = within(bar).getAllByRole('button');
  expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual([
    'Switch to night',
    'Resume motion',
    'Enable ambient sound',
    'Share this location',
    null,
  ]);
  for (const b of buttons.slice(0, 4)) expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
  const trace = buttons[4];
  expect(trace.textContent).toBe('Ray TracingOFF');
  expect(trace.getAttribute('title')).toBe('Progressive ray-traced photo mode. Motion pauses; drag to compose.');
  expect(trace.getAttribute('aria-pressed')).toBe('false');
});

test('motion runs from the start without reduced motion', () => {
  render(<App quality="high" initialTime="day" reducedMotion={false} webgl2 />);
  expect(screen.getByRole('button', { name: 'Pause motion' })).toBeTruthy();
  expect(screen.getByText('CINEMATIC TOUR · DRAG TO EXPLORE')).toBeTruthy();
});

test('the credit names the builder as the spec spells it and links the university', () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  const credit = screen.getByRole('region', { name: 'The builder' });
  expect(within(credit).getByText('AN INDEPENDENT WORLD BY')).toBeTruthy();
  const name = within(credit).getByRole('button', { name: "About Umaraliev Ravshan Rustamjon O'gli" });
  expect(name.textContent).toBe("UMARALIEV RAVSHAN RUSTAMJON O'GLI");
  expect(within(credit).getByText('AI Engineer · Systems Builder')).toBeTruthy();
  const link = within(credit).getByRole('link', { name: 'Turin Polytechnic University in Tashkent' });
  expect(link.getAttribute('href')).toBe('https://turin.uz');
  expect(link.getAttribute('target')).toBe('_blank');
  expect(link.getAttribute('rel')).toBe('noreferrer');
});

test('the location names the sector, and the guidance line says how to move', () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  expect(screen.getByText('THE FLOATING CITY')).toBeTruthy();
  expect(screen.getByText('000')).toBeTruthy();
  expect(screen.getByText('DRAG TO ORBIT · SCROLL TO EXPLORE')).toBeTruthy();
  cleanup();
  render(<App quality="high" initialTime="day" reducedMotion webgl2 sector="street" />);
  expect(screen.getByText('THE LIVING QUARTER')).toBeTruthy();
  expect(screen.getByText('001')).toBeTruthy();
});

test('the city greets the console with its transmission', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  expect(info).toHaveBeenCalledWith(
    '%cA TRANSMISSION FROM THE FLOATING CITY',
    'color:#e2b183;font-size:16px;font-family:monospace',
  );
  expect(info).toHaveBeenCalledWith(
    '65 75 6b 61 6c 70 69 61\nA small beacon carries this name. Find its glow between the buildings.',
  );
  info.mockRestore();
});

test('the page head and noscript carry v1 copy with the builder name as the spec spells it', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  expect(html).toContain('<title>EUKALPIA // The city that compiles</title>');
  expect(html).toContain(
    'content="EUKALPIA — The city that compiles. An explorable world by Umaraliev Ravshan Rustamjon O\'gli. Some things are meant to be found."',
  );
  expect(html).toContain("<p>UMARALIEV RAVSHAN RUSTAMJON O'GLI</p>");
  expect(html).toContain('<meta name="theme-color" content="#0b1015"');
  expect(html).not.toMatch(/Ugli|UGLI/);
});

test('postcard mode keeps the interface: the image replaces the canvas, Walk and Ray Tracing are off', () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2={false} />);
  const img = screen.getByAltText('A captured view of the floating 3D city');
  expect(img.getAttribute('src')).toMatch(/city-cinematic\.webp$/);
  expect(screen.getByText('POSTCARD MODE · Open Projects to explore every district.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Walk through the city' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: /^Ray Tracing/ })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Explore projects' })).toHaveProperty('disabled', false);
  expect(document.querySelector('.city-stage')!.classList.contains('is-fallback')).toBe(true);
  // The boot line gives way: the page is as ready as it will get.
  expect(screen.queryByText('ASSEMBLING THE WORLD')).toBeNull();
});

test('the dock and the credit open their panels; choosing a project opens its inspector', async () => {
  render(<App quality="high" initialTime="day" reducedMotion webgl2 />);
  await act(async () => resolveWorld(fakeWorld()));
  fireEvent.click(screen.getByRole('button', { name: 'Controls and help' }));
  expect(screen.getByRole('dialog', { name: 'Make yourself at home.' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: "About Umaraliev Ravshan Rustamjon O'gli" }));
  expect(screen.getByRole('dialog', { name: 'The builder.' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Discoveries, 0 of 6 found' }));
  expect(screen.getByRole('dialog', { name: 'Look a little closer.' })).toBeTruthy();
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Explore projects' }));
  fireEvent.click(screen.getByText('University LMS'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('complementary', { name: 'University LMS' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close district details' }));
  expect(screen.queryByRole('complementary')).toBeNull();
});
