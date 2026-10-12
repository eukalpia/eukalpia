import { useEffect, useRef, useState } from 'react';
import { createWorld, type QualityTier, type TimeOfDay, type World } from '../engine/world';
import type { DebugFlag, ShotName } from '../engine/debug';
import { PhotoPanel } from './PhotoPanel';
import type { Sector } from './url';

export interface AppProps {
  quality: QualityTier;
  initialTime: TimeOfDay;
  shot?: ShotName;
  reducedMotion: boolean;
  webgl2: boolean;
  debug?: DebugFlag[];
  sector?: Sector;
}

export function Postcard() {
  return (
    <figure className="postcard">
      <img src={`${import.meta.env.BASE_URL}city-cinematic.webp`} alt="A captured view of the floating 3D city" />
      <figcaption>POSTCARD MODE · Open Projects to explore every district.</figcaption>
    </figure>
  );
}

export function App({ quality, initialTime, shot, reducedMotion, webgl2, debug, sector }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [postcard, setPostcard] = useState(!webgl2);
  const [time, setTime] = useState<TimeOfDay>(initialTime);
  const [walking, setWalking] = useState(false);
  const [world, setWorld] = useState<World | null>(null);
  // The world may still be loading when the visitor toggles Day/Night; apply the latest choice once it exists.
  const timeRef = useRef(time);
  timeRef.current = time;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || postcard) return;
    let disposed = false;
    createWorld(canvas, { quality, time: initialTime, shot, reducedMotion, debug, sector })
      .then(world => {
        if (disposed) return world.dispose();
        worldRef.current = world;
        setWorld(world);
        if (timeRef.current !== initialTime) world.setTime(timeRef.current);
        // Esc, ?sector=street and the lift can change the mode without the button.
        world.onModeChange?.(mode => setWalking(mode === 'walk'));
      })
      .catch(error => {
        console.warn('EUKALPIA: falling back to postcard mode.', error);
        setPostcard(true);
      });
    const onResize = () => worldRef.current?.resize(window.innerWidth, window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      worldRef.current?.dispose();
      worldRef.current = null;
      setWorld(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, initialTime, shot, reducedMotion, postcard]);

  useEffect(() => worldRef.current?.setTime(time), [time]);

  // A short notice, e.g. why walking is not available yet.
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(id);
  }, [notice]);

  // Temporary lift hint until the full interface lands: what the L key would do right now.
  const [liftHint, setLiftHint] = useState<string | null>(null);
  useEffect(() => {
    if (!walking) return setLiftHint(null);
    const id = window.setInterval(() => {
      const s = worldRef.current?.liftStatus?.();
      setLiftHint(!s || s.label === 'LMS lift · locating…' ? null : s.available ? `L · ${s.label}` : s.label);
    }, 200);
    return () => window.clearInterval(id);
  }, [walking]);

  if (postcard) return <Postcard />;
  return (
    <main className="world-shell">
      <canvas ref={canvasRef} className="city-canvas" />
      <button
        className="world-utility"
        onClick={() => setTime(t => (t === 'night' ? 'day' : 'night'))}
        aria-label={time === 'night' ? 'Switch to daylight' : 'Switch to night'}
      >
        {time === 'night' ? 'DAY' : 'NIGHT'}
      </button>
      <button
        className="world-utility world-utility-walk"
        onClick={() => {
          const world = worldRef.current;
          if (!world) return;
          const next = !walking;
          if (world.setMode(next ? 'walk' : 'orbit')) setWalking(next);
          else if (next)
            setNotice(
              world.walkState?.() === 'failed'
                ? 'Walking is unavailable: UR-01 could not load.'
                : 'UR-01 is still loading…',
            );
        }}
        aria-label={walking ? 'Return to orbit' : 'Walk through the city'}
      >
        {walking ? 'ORBIT' : 'WALK'}
      </button>
      <PhotoPanel world={world} canvas={canvasRef.current} />
      {(notice ?? liftHint) && (
        <p className="world-hint" role="status">
          {notice ?? liftHint}
        </p>
      )}
    </main>
  );
}
