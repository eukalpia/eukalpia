import {
  ArrowUp,
  ArrowUpDown,
  Camera,
  Footprints,
  LogOut,
  Map as MapIcon,
  PersonStanding,
  ScanLine,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

const LIFT_SHORT: Record<string, string> = {
  'Ride to LMS roof': 'To roof',
  'Ride to street': 'To street',
  'Call LMS lift': 'Call lift',
  'Lift ascending': 'Ascending',
  'Lift descending': 'Descending',
  'Lift arriving': 'Arriving',
};

/** v1's short lift labels: an exact table, otherwise "LMS lift · " becomes "Lift · ". */
export function shortLiftLabel(label: string): string {
  return LIFT_SHORT[label] ?? label.replace('LMS lift · ', 'Lift · ');
}

/** The stick's vector for a press dx, dy from its centre: dead zone 13 % of R, R = 38 % of its width; up is forward. */
export function joystickVector(dx: number, dy: number, width: number): [number, number] {
  const R = 0.38 * width;
  const dead = 0.13 * R;
  const d = Math.hypot(dx, dy);
  if (d <= dead) return [0, 0];
  const m = Math.min(1, (d - dead) / (R - dead));
  return [(dx / d) * m, (-dy / d) * m];
}

export interface WalkControlsProps {
  firstPerson: boolean;
  lift: { label: string; available: boolean } | null;
  running: boolean;
  onView(): void;
  onLift(): void;
  onProjects(): void;
  onExit(): void;
  onStick(x: number, y: number): void;
  onRun(): void;
  onJump(): void;
  onInspect(): void;
}

function Joystick({ onStick }: { onStick(x: number, y: number): void }) {
  const [knob, setKnob] = useState<[number, number]>([0, 0]);
  const pressed = useRef(false);
  const release = () => {
    pressed.current = false;
    setKnob([0, 0]);
    onStick(0, 0);
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!pressed.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const v = joystickVector(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width);
    setKnob(v);
    onStick(v[0], v[1]);
  };
  // A stick still held when the controls unmount (a panel opened) must not keep UR-01 walking.
  const latest = useRef(onStick);
  latest.current = onStick;
  useEffect(
    () => () => {
      if (pressed.current) latest.current(0, 0);
    },
    [],
  );
  useEffect(() => {
    const hidden = () => document.hidden && pressed.current && release();
    const blur = () => pressed.current && release();
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', hidden);
    };
  });
  return (
    <button
      className="walk-stick"
      aria-label="Movement joystick. Drag to walk."
      onPointerDown={e => {
        pressed.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={() => pressed.current && release()}
    >
      <span className="stick-ring" />
      <span className="stick-knob" style={{ transform: `translate(${knob[0] * 36}px, ${-knob[1] * 36}px)` }}>
        <Footprints size={20} />
      </span>
      <span className="stick-caption">MOVE</span>
    </button>
  );
}

/** v1's walking interface (inventory 1.3): identity, toolbar, hints, reticle, and the touch controls. */
export function WalkControls(p: WalkControlsProps) {
  const lift = p.lift ?? { label: 'LMS lift · locating…', available: false };
  return (
    <section className="walking-controls" aria-label="Character controls">
      <div className="walk-identity">
        <span className="status-dot" />
        <span>
          UR–01
          <small>EXPLORER</small>
        </span>
        <span className="walk-view-label">{p.firstPerson ? 'FIRST PERSON' : 'THIRD PERSON'}</span>
      </div>
      <div className="walk-toolbar">
        <button aria-label={p.firstPerson ? 'Switch to third person' : 'Switch to first person'} onClick={p.onView}>
          <Camera size={17} />
          <span>{p.firstPerson ? '3rd person' : '1st person'}</span>
          <kbd>V</kbd>
        </button>
        <button className="walk-lift" aria-label={lift.label} disabled={!lift.available} onClick={p.onLift}>
          <ArrowUpDown size={17} />
          <span aria-live="polite">{shortLiftLabel(lift.label)}</span>
          <kbd>L</kbd>
        </button>
        <button aria-label="Explore projects while walking" onClick={p.onProjects}>
          <MapIcon size={17} />
        </button>
        <button aria-label="Leave walking mode" onClick={p.onExit}>
          <LogOut size={17} />
          <span>Exit walk</span>
        </button>
      </div>
      <div className="walk-desktop-hints">
        <span>
          <kbd>W A S D</kbd> Move
        </span>
        <span>
          <kbd>SHIFT</kbd> Run
        </span>
        <span>
          <kbd>SPACE</kbd> Jump
        </span>
        <span>
          <kbd>F</kbd> Inspect
        </span>
        <span>
          Click to look · <kbd>ESC</kbd> Release
        </span>
      </div>
      <div className="walk-reticle" aria-hidden="true" />
      <Joystick onStick={p.onStick} />
      <p className="walk-touch-hint">SWIPE THE WORLD TO LOOK</p>
      <div className="walk-touch-actions">
        <button className="walk-inspect" aria-label="Inspect what you are looking at" onClick={p.onInspect}>
          <ScanLine size={21} />
          INSPECT
        </button>
        <button
          className={p.running ? 'is-running' : ''}
          aria-label={p.running ? 'Switch to walking' : 'Switch to running'}
          aria-pressed={p.running}
          onClick={p.onRun}
        >
          <PersonStanding size={23} />
          {p.running ? 'RUN' : 'WALK'}
        </button>
        <button className="walk-jump" aria-label="Jump" onClick={p.onJump}>
          <ArrowUp size={27} />
          JUMP
        </button>
      </div>
    </section>
  );
}
