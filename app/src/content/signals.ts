export type SignalId = 'cat' | 'monolith' | 'override' | 'underworld' | 'cipher' | 'ghost';

export interface Signal {
  name: string;
  hint: string;
  message: string;
}

/** The six hidden discoveries. Copy is carried over verbatim from v1. */
export const SIGNALS: Record<SignalId, Signal> = {
  cat: {
    name: 'Rooftop resident',
    hint: 'Someone with whiskers lives near Admissions. Look closely at the rooftops.',
    message: 'ROOFTOP RESIDENT · The city has adopted you.',
  },
  monolith: {
    name: 'Seven knocks',
    hint: 'The tallest building is listening. Persistence is a number.',
    message: 'SEVEN KNOCKS · You found the heartbeat.',
  },
  override: {
    name: 'Old-school access',
    hint: 'A familiar code. Two steps up, two steps down. The rest is muscle memory.',
    message: 'OVERRIDE ACCEPTED · Welcome to the other side.',
  },
  underworld: {
    name: 'Below the surface',
    hint: 'Read the builder’s profile carefully. There is an unmarked elevator.',
    message: 'FLOOR -1 · Even floating cities have roots.',
  },
  cipher: {
    name: 'Inside the source',
    hint: 'A small transmission beacon carries the city’s name. Find its glow between the buildings.',
    message: 'CIPHER RESOLVED · You were always meant to find this.',
  },
  ghost: {
    name: 'After hours',
    hint: 'Switch to night. Someone is awake in a north-side window.',
    message: 'AFTER HOURS · Some builders never really log off.',
  },
};

export const SIGNAL_ORDER: readonly SignalId[] = ['cat', 'monolith', 'override', 'underworld', 'cipher', 'ghost'];
