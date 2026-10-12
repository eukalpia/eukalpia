import { vi } from 'vitest';
import { AMBIENT_GAIN, AMBIENT_TONES, createAmbient } from '../src/app/sound';

function fakeAudio() {
  const oscillators: { frequency: { value: number }; type: string; started: boolean; stopped: boolean }[] = [];
  const ctx = {
    state: 'suspended',
    destination: {},
    resume: vi.fn(async () => void (ctx.state = 'running')),
    suspend: vi.fn(async () => void (ctx.state = 'suspended')),
    close: vi.fn(async () => {}),
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn() }),
    createOscillator: () => {
      const o = {
        type: 'square',
        frequency: { value: 0 },
        started: false,
        stopped: false,
        connect: vi.fn(),
        start() {
          o.started = true;
        },
        stop() {
          o.stopped = true;
        },
      };
      oscillators.push(o);
      return o;
    },
  };
  return { ctx, oscillators };
}

test('nothing sounds, and no audio context exists, until the visitor asks', async () => {
  const make = vi.fn(() => fakeAudio().ctx);
  const ambient = createAmbient(make as never);
  expect(make).not.toHaveBeenCalled();
  await ambient.setOn(false);
  expect(make).not.toHaveBeenCalled();
});

test("v1's drone: four sine tones (C2, G2, C3, G3) at a whisper; off suspends, dispose stops", async () => {
  expect(AMBIENT_TONES).toEqual([65.41, 98, 130.81, 196]);
  expect(AMBIENT_GAIN).toBe(0.018);
  const audio = fakeAudio();
  const ambient = createAmbient(() => audio.ctx as never);
  await ambient.setOn(true);
  expect(audio.oscillators.map(o => [o.type, o.frequency.value, o.started])).toEqual(
    AMBIENT_TONES.map(f => ['sine', f, true]),
  );
  expect(audio.ctx.state).toBe('running');
  await ambient.setOn(false);
  expect(audio.ctx.suspend).toHaveBeenCalled();
  await ambient.setOn(true);
  expect(audio.oscillators).toHaveLength(4);
  ambient.dispose();
  expect(audio.oscillators.every(o => o.stopped)).toBe(true);
  expect(audio.ctx.close).toHaveBeenCalled();
});

test('a browser without audio rejects, so the interface can say so', async () => {
  const ambient = createAmbient(() => {
    throw new Error('no audio');
  });
  await expect(ambient.setOn(true)).rejects.toThrow();
});

test('switched off before the drone has started, it stays silent', async () => {
  const audio = fakeAudio();
  let started: () => void = () => {};
  audio.ctx.resume = vi.fn(
    () =>
      new Promise<undefined>(r => {
        started = () => {
          audio.ctx.state = 'running';
          r(undefined);
        };
      }),
  );
  const ambient = createAmbient(() => audio.ctx as never);
  const on = ambient.setOn(true);
  await ambient.setOn(false);
  started();
  await on;
  expect(audio.ctx.state).toBe('suspended');
});
