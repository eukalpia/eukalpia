import { useEffect, useRef, useState } from 'react';
import { createWorld, type QualityTier, type TimeOfDay, type World } from '../engine/world';
import type { DebugFlag, ShotName } from '../engine/debug';
import { DISTRICTS } from '../content/districts';
import { Boot, Credit, Dock, greetConsole, Guidance, guidanceText, Location, Toast, Utilities } from './chrome';
import { Inspector } from './Inspector';
import { BuilderPanel } from './panels/Builder';
import { DiscoveriesPanel } from './panels/Discoveries';
import { HelpPanel } from './panels/Help';
import { ProjectsPanel } from './panels/Projects';
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

/** What shows in place of the canvas when WebGL is missing or the city failed to start. */
export function Postcard() {
  return (
    <figure className="fallback">
      <img src={`${import.meta.env.BASE_URL}city-cinematic.webp`} alt="A captured view of the floating 3D city" />
      <figcaption>POSTCARD MODE · Open Projects to explore every district.</figcaption>
    </figure>
  );
}

const TOAST_MS = 5500;

type PanelId = 'districts' | 'signals' | 'author' | 'help';

export function App({ quality, initialTime, shot, reducedMotion, webgl2, debug, sector = 'overview' }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [postcard, setPostcard] = useState(!webgl2);
  const [time, setTime] = useState<TimeOfDay>(initialTime);
  const [walking, setWalking] = useState(false);
  const [world, setWorld] = useState<World | null>(null);
  const [paused, setPaused] = useState(reducedMotion);
  const [sound, setSound] = useState(false);
  const [tracing, setTracing] = useState(false);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // The world may still be loading when the visitor toggles Day/Night; apply the latest choice once it exists.
  const timeRef = useRef(time);
  timeRef.current = time;

  useEffect(greetConsole, []);

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

  // One shared message slot; a newer message restarts the clock (v1 let an older timer clear it early).
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  // Temporary lift hint until the walking controls land: what the L key would do right now.
  const [liftHint, setLiftHint] = useState<string | null>(null);
  useEffect(() => {
    if (!walking) return setLiftHint(null);
    const id = window.setInterval(() => {
      const s = worldRef.current?.liftStatus?.();
      setLiftHint(!s || s.label === 'LMS lift · locating…' ? null : s.available ? `L · ${s.label}` : s.label);
    }, 200);
    return () => window.clearInterval(id);
  }, [walking]);

  const enterWalk = () => {
    const world = worldRef.current;
    if (!world) return;
    if (world.setMode('walk')) setWalking(true);
    else
      setToast(
        world.walkState?.() === 'failed'
          ? 'The exploration suit could not load. Please try Walk again.'
          : 'UR-01 is still loading…',
      );
  };
  const toOrbit = () => {
    if (walking && worldRef.current?.setMode('orbit')) setWalking(false);
  };

  // Postcard mode is as ready as the page will get: the boot line goes, the interface stays.
  const ready = world !== null || postcard;
  const tour = !reducedMotion && !shot && sector === 'overview' && !walking;
  const selectedDistrict = DISTRICTS.find(d => d.id === selected) ?? null;
  const classes = [
    'world-shell immersive-world is-exploring',
    walking && 'is-walking',
    ready && 'is-ready',
    time === 'night' ? 'night' : 'dawn',
  ].filter(Boolean);

  return (
    <main className={classes.join(' ')}>
      <div className="world-vignette" aria-hidden="true" />
      <div className={`city-stage${postcard ? ' is-fallback' : ''}`}>
        <div className="city-canvas">
          <canvas
            ref={canvasRef}
            role="img"
            tabIndex={0}
            aria-label="Interactive floating city. Drag to orbit, scroll to zoom. Buildings and small hidden objects can be selected."
          />
        </div>
        {postcard && <Postcard />}
      </div>
      {!ready && <Boot />}
      <Location sector={sector} />
      <Utilities
        night={time === 'night'}
        paused={paused}
        pauseLocked={tracing}
        sound={sound}
        shareCopied={false}
        onNight={() => setTime(t => (t === 'night' ? 'day' : 'night'))}
        onPause={() => setPaused(p => !p)}
        onSound={() => setSound(s => !s)}
        onShare={() => {}}
      >
        <PhotoPanel world={world} canvas={canvasRef.current} onChange={setTracing} />
      </Utilities>
      <Guidance text={guidanceText({ tracing, hover: null, fly: false, tour })} hovered={false} />
      <footer className="world-interface">
        <Credit onBuilder={() => setPanel('author')} />
        <Dock
          walkDisabled={world === null}
          orbitActive={!walking && panel === null}
          districts={DISTRICTS.length}
          found={0}
          onOrbit={toOrbit}
          onWalk={enterWalk}
          onProjects={() => setPanel('districts')}
          onDiscoveries={() => setPanel('signals')}
          onHelp={() => setPanel('help')}
        />
      </footer>
      {selectedDistrict && <Inspector district={selectedDistrict} onClose={() => setSelected(null)} />}
      <Toast text={toast} />
      {panel === 'districts' && (
        <ProjectsPanel
          onSelect={id => {
            setSelected(id);
            setPanel(null);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'signals' && <DiscoveriesPanel found={[]} onClose={() => setPanel(null)} />}
      {panel === 'author' && <BuilderPanel onMaintenance={() => setPanel(null)} onClose={() => setPanel(null)} />}
      {panel === 'help' && (
        <HelpPanel
          sector={sector}
          pixelated={false}
          fly={false}
          actions={{
            tour: () => setPanel(null),
            street: () => setPanel(null),
            pixel: () => {},
            fly: () => setPanel(null),
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {liftHint && <p className="world-hint">{liftHint}</p>}
    </main>
  );
}
