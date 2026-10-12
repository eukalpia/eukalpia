import { Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { World } from '../engine/world';
import { saveName } from '../phototrace/focus';

const F_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
const DEFAULT_STOP = 5; // f/8: nearly everything sharp

type Status = ReturnType<World['photo']['status']>;

/** v1's progress line, with a singular for one sample. */
export function traceStatusText(status: Status): string {
  if (status?.phase !== 'tracing') return 'Preparing ray tracing…';
  const n = Math.floor(status.samples);
  return `Refining light · ${n} ${n === 1 ? 'sample' : 'samples'} · drag to reframe`;
}

/**
 * v1's Ray Tracing toggle under the utilities bar; while tracing: progress, aperture,
 * click-to-focus, Save frame and Exit.
 */
export function PhotoPanel({
  world,
  canvas,
  onChange,
  tracing,
}: {
  world: World | null;
  canvas: HTMLCanvasElement | null;
  /** Told when photo mode starts or ends, whoever ended it. */
  onChange?(open: boolean): void;
  /** The interface's view: when it turns false (walking, the tour, free flight), photo mode ends. */
  tracing?: boolean;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onChange?.(next);
  };
  const [status, setStatus] = useState<Status>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [stop, setStop] = useState(DEFAULT_STOP);

  const close = () => {
    world?.photo.exit();
    setOpen(false);
    setStatus(null);
  };

  useEffect(() => {
    if (open && tracing === false) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracing]);

  useEffect(() => {
    if (!world) return;
    world.photo.onError(message => {
      setOpen(false);
      setStatus(null);
      setAlert(message);
    });
  }, [world]);

  useEffect(() => {
    if (!alert) return;
    const id = window.setTimeout(() => setAlert(null), 6000);
    return () => window.clearTimeout(id);
  }, [alert]);

  useEffect(() => {
    if (!open || !world) return;
    const tick = () => setStatus(world.photo.status());
    tick();
    const id = window.setInterval(tick, 250);
    // Escape closes a panel open over photo mode first.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('dialog[open]') && close();
    window.addEventListener('keydown', onKey);
    const onClick = (e: MouseEvent) => {
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      world.photo.focusAt(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    canvas?.addEventListener('click', onClick);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('keydown', onKey);
      canvas?.removeEventListener('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, world, canvas]);

  const enter = async () => {
    if (!world) return;
    setAlert(null);
    setOpen(true);
    setStop(DEFAULT_STOP);
    const result = await world.photo.enter();
    if (!result.ok) {
      setOpen(false);
      setStatus(null);
      if (result.message) setAlert(result.message);
    }
  };

  const save = async () => {
    if (!world) return;
    try {
      const blob = await world.photo.save();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = saveName(new Date());
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setAlert(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <button
        className={`world-trace-toggle${open ? ' active' : ''}`}
        aria-pressed={open}
        title="Progressive ray-traced photo mode. Motion pauses; drag to compose."
        disabled={!world}
        onClick={open ? close : enter}
      >
        <Sun size={13} />
        Ray Tracing<small>{open ? 'ON' : 'OFF'}</small>
      </button>
      {open && (
        <section className="photo-panel" aria-label="Photo mode">
          <p className="trace-status" role="status" aria-live="polite">
            {traceStatusText(status)}
          </p>
          <label className="photo-aperture">
            <span>Aperture</span>
            <input
              type="range"
              aria-label="Aperture"
              min={0}
              max={F_STOPS.length - 1}
              step={1}
              value={stop}
              onChange={e => {
                const i = Number(e.target.value);
                setStop(i);
                world?.photo.setAperture(F_STOPS[i]);
              }}
            />
            <span>f/{F_STOPS[stop]}</span>
          </label>
          <p className="photo-hint">Click to focus</p>
          <div className="photo-actions">
            <button onClick={save}>Save frame</button>
            <button onClick={close}>Exit</button>
          </div>
        </section>
      )}
      {alert && (
        <p className="world-alert" role="alert">
          {alert}
        </p>
      )}
    </>
  );
}
