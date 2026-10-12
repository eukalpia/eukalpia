/** v1's ambient drone: C2, G2, C3 and G3, barely audible. */
export const AMBIENT_TONES = [65.41, 98, 130.81, 196];
export const AMBIENT_GAIN = 0.018;

export interface Ambient {
  /** Rejects when the browser has no usable audio. */
  setOn(on: boolean): Promise<void>;
  dispose(): void;
}

/** The context is made on the first request to play, since browsers only allow audio after a gesture. */
export function createAmbient(make: () => AudioContext = () => new AudioContext()): Ambient {
  let ctx: AudioContext | null = null;
  let oscillators: OscillatorNode[] = [];
  let wanted = false;

  const start = () => {
    const audio = make();
    const gain = audio.createGain();
    gain.gain.value = AMBIENT_GAIN;
    gain.connect(audio.destination);
    oscillators = AMBIENT_TONES.map(f => {
      const o = audio.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      return o;
    });
    ctx = audio;
    return audio;
  };

  return {
    async setOn(on) {
      wanted = on;
      if (!on) {
        await ctx?.suspend();
        return;
      }
      const audio = ctx ?? start();
      await audio.resume();
      // Switched off again while the context was still starting.
      if (!wanted) await audio.suspend();
    },
    dispose() {
      for (const o of oscillators) o.stop();
      oscillators = [];
      void ctx?.close();
      ctx = null;
    },
  };
}
