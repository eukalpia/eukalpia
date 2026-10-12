import { useEffect, useRef, useState } from 'react';
import { createWorld, type QualityTier, type TimeOfDay, type World } from '../engine/world';
import type { DebugFlag, ShotName } from '../engine/debug';

export interface AppProps {
  quality: QualityTier;
  initialTime: TimeOfDay;
  shot?: ShotName;
  reducedMotion: boolean;
  webgl2: boolean;
  debug?: DebugFlag[];
}

export function Postcard() {
  return (
    <figure className="postcard">
      <img src={`${import.meta.env.BASE_URL}city-cinematic.webp`} alt="A captured view of the floating 3D city" />
      <figcaption>POSTCARD MODE · Open Projects to explore every district.</figcaption>
    </figure>
  );
}

export function App({ quality, initialTime, shot, reducedMotion, webgl2, debug }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [postcard, setPostcard] = useState(!webgl2);
  const [time, setTime] = useState<TimeOfDay>(initialTime);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || postcard) return;
    let disposed = false;
    createWorld(canvas, { quality, time: initialTime, shot, reducedMotion, debug })
      .then(world => {
        if (disposed) return world.dispose();
        worldRef.current = world;
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, initialTime, shot, reducedMotion, postcard]);

  useEffect(() => worldRef.current?.setTime(time), [time]);

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
    </main>
  );
}
