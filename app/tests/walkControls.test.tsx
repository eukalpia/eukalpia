// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { joystickVector, shortLiftLabel, WalkControls, type WalkControlsProps } from '../src/app/walk/WalkControls';

afterEach(cleanup);

const props = (over: Partial<WalkControlsProps> = {}): WalkControlsProps => ({
  firstPerson: false,
  lift: { label: 'LMS lift · 35m', available: false },
  running: false,
  onView: vi.fn(),
  onLift: vi.fn(),
  onProjects: vi.fn(),
  onExit: vi.fn(),
  onStick: vi.fn(),
  onRun: vi.fn(),
  onJump: vi.fn(),
  onInspect: vi.fn(),
  ...over,
});

test('lift labels shorten as v1 shortened them', () => {
  expect(shortLiftLabel('LMS lift · locating…')).toBe('Lift · locating…');
  expect(shortLiftLabel('LMS lift · 35m')).toBe('Lift · 35m');
  expect(shortLiftLabel('Ride to LMS roof')).toBe('To roof');
  expect(shortLiftLabel('Ride to street')).toBe('To street');
  expect(shortLiftLabel('Call LMS lift')).toBe('Call lift');
  expect(shortLiftLabel('Lift ascending')).toBe('Ascending');
  expect(shortLiftLabel('Lift descending')).toBe('Descending');
  expect(shortLiftLabel('Lift arriving')).toBe('Arriving');
});

test('the joystick: a dead zone in the middle, full speed at the rim, up is forward', () => {
  const width = 126;
  const R = 0.38 * width;
  expect(joystickVector(0.1 * R, 0, width)).toEqual([0, 0]);
  const [x, y] = joystickVector(0, -R, width);
  expect(x).toBeCloseTo(0, 6);
  expect(y).toBeCloseTo(1, 6);
  const [x2, y2] = joystickVector(3 * R, 0, width);
  expect(x2).toBeCloseTo(1, 6);
  expect(y2).toBeCloseTo(0, 6);
  const [hx] = joystickVector(0.5 * R, 0, width);
  expect(hx).toBeGreaterThan(0.3);
  expect(hx).toBeLessThan(0.55);
});

test('the walk panel: identity, view toggle, lift, projects and exit', () => {
  const p = props();
  render(<WalkControls {...p} />);
  const section = screen.getByRole('region', { name: 'Character controls' });
  expect(section.textContent).toContain('UR–01');
  expect(section.textContent).toContain('EXPLORER');
  expect(section.textContent).toContain('THIRD PERSON');
  fireEvent.click(screen.getByRole('button', { name: 'Switch to first person' }));
  const lift = screen.getByRole('button', { name: 'LMS lift · 35m' });
  expect(lift.textContent).toContain('Lift · 35m');
  expect(lift).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'Explore projects while walking' }));
  fireEvent.click(screen.getByRole('button', { name: 'Leave walking mode' }));
  expect([p.onView, p.onProjects, p.onExit].map(f => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([
    1, 1, 1,
  ]);
  expect(screen.getByText(/Click to look/)).toBeTruthy();
});

test('in first person the view button offers third person; an available lift can be pressed', () => {
  const p = props({ firstPerson: true, lift: { label: 'Ride to LMS roof', available: true } });
  render(<WalkControls {...p} />);
  expect(screen.getByRole('button', { name: 'Switch to third person' })).toBeTruthy();
  expect(screen.getByText('FIRST PERSON')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Ride to LMS roof' }));
  expect(p.onLift).toHaveBeenCalled();
});

test('touch: the stick drives the character and lets go on release, cancel, capture loss, blur and hiding', () => {
  const p = props();
  render(<WalkControls {...p} />);
  const stick = screen.getByRole('button', { name: 'Movement joystick. Drag to walk.' });
  stick.getBoundingClientRect = () => ({ left: 0, top: 0, width: 126, height: 126 }) as DOMRect;
  const onStick = p.onStick as ReturnType<typeof vi.fn>;
  for (const end of ['pointerUp', 'pointerCancel', 'lostPointerCapture', 'blur', 'hidden'] as const) {
    fireEvent.pointerDown(stick, { pointerId: 1, clientX: 63, clientY: 10 });
    expect(onStick.mock.calls.at(-1)![1]).toBeGreaterThan(0.5);
    if (end === 'blur') act(() => void window.dispatchEvent(new Event('blur')));
    else if (end === 'hidden') {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      act(() => void document.dispatchEvent(new Event('visibilitychange')));
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    } else fireEvent[end](stick, { pointerId: 1 });
    expect(onStick.mock.calls.at(-1), end).toEqual([0, 0]);
  }
});

test('touch actions: INSPECT, the run toggle, JUMP', () => {
  const p = props({ running: true });
  render(<WalkControls {...p} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect what you are looking at' }));
  const run = screen.getByRole('button', { name: 'Switch to walking' });
  expect(run.getAttribute('aria-pressed')).toBe('true');
  expect(run.textContent).toContain('RUN');
  fireEvent.click(run);
  fireEvent.click(screen.getByRole('button', { name: 'Jump' }));
  expect([p.onInspect, p.onRun, p.onJump].map(f => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([
    1, 1, 1,
  ]);
  expect(screen.getByText('SWIPE THE WORLD TO LOOK')).toBeTruthy();
});

test('a stick held when the controls go away (a panel opens) lets go', () => {
  const p = props();
  const { unmount } = render(<WalkControls {...p} />);
  const stick = screen.getByRole('button', { name: 'Movement joystick. Drag to walk.' });
  stick.getBoundingClientRect = () => ({ left: 0, top: 0, width: 126, height: 126 }) as DOMRect;
  fireEvent.pointerDown(stick, { pointerId: 1, clientX: 63, clientY: 10 });
  unmount();
  expect((p.onStick as ReturnType<typeof vi.fn>).mock.calls.at(-1)).toEqual([0, 0]);
});
