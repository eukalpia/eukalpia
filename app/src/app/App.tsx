import { useEffect, useReducer, useRef, useState } from 'react';
import { createWorld, type QualityTier, type TimeOfDay, type World } from '../engine/world';
import type { DebugFlag, ShotName } from '../engine/debug';
import { DISTRICTS } from '../content/districts';
import { Boot, Credit, Dock, greetConsole, Guidance, guidanceText, Location, Toast, Utilities } from './chrome';
import { Inspector } from './Inspector';
import { createKeys, otherSector } from './keys';
import { BuilderPanel } from './panels/Builder';
import { DiscoveriesPanel } from './panels/Discoveries';
import { HelpPanel } from './panels/Help';
import { ProjectsPanel } from './panels/Projects';
import { PhotoPanel } from './PhotoPanel';
import { initialUiState, uiReducer, type UiAction } from './state';
import { shareUrl, withSector, type Sector } from './url';

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
const COPIED_MS = 2500;
const FREE_FLIGHT = 'FREE FLIGHT · Click the city, then W A S D to move. Q / E change altitude. Drag to turn.';
const SUIT_FAILED = 'The exploration suit could not load. Please try Walk again.';
const SUIT_LOADING = 'UR-01 is still loading…';

/** Free-flight keys (by code, so any keyboard layout works) → movement axes. */
const FLY_KEYS: Record<string, [axis: 'forward' | 'right' | 'up', sign: number]> = {
  KeyW: ['forward', 1],
  ArrowUp: ['forward', 1],
  KeyS: ['forward', -1],
  ArrowDown: ['forward', -1],
  KeyD: ['right', 1],
  ArrowRight: ['right', 1],
  KeyA: ['right', -1],
  ArrowLeft: ['right', -1],
  KeyE: ['up', 1],
  Space: ['up', 1],
  KeyQ: ['up', -1],
};

export function App({ quality, initialTime, shot, reducedMotion, webgl2, debug, sector = 'overview' }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const [postcard, setPostcard] = useState(!webgl2);
  const [world, setWorld] = useState<World | null>(null);
  const [ui, dispatch] = useReducer(
    uiReducer,
    { sector, reducedMotion, shot: !!shot, night: initialTime === 'night' },
    initialUiState,
  );
  const uiRef = useRef(ui);
  uiRef.current = ui;

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
        // Esc, ?sector=street and the lift can change the mode without the dock.
        world.onModeChange?.(mode => dispatch({ type: 'walk', on: mode === 'walk' }));
        world.onTourChange?.(on => !on && dispatch({ type: 'tourEnded' }));
        world.onHover?.(label => setHover(label));
        world.onPick?.(target => {
          if (target.kind === 'district') dispatch({ type: 'select', id: target.id });
          else if (target.kind === 'vehicle' && !uiRef.current.walking) world.followVehicle?.();
        });
        if (sector === 'underworld') world.setSector?.('underworld');
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

  const [hover, setHover] = useState<string | null>(null);

  // One shared message slot; a newer message restarts the clock (v1 let an older timer clear it early).
  const [toast, setToast] = useState('');
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(''), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [toast]);

  // The world follows the interface state.
  useEffect(() => world?.setTime(ui.night ? 'night' : 'day'), [world, ui.night]);
  useEffect(() => world?.setPaused?.(ui.paused), [world, ui.paused]);
  useEffect(() => {
    // Ending the tour happens in the world (a drag, a flight, photo mode); here it only starts.
    if (ui.tour) world?.setTour?.(true);
  }, [world, ui.tour]);
  useEffect(() => world?.setFly?.(ui.fly), [world, ui.fly]);
  const pixelSeen = useRef(false);
  useEffect(() => {
    if (!world || (!ui.pixelated && !pixelSeen.current)) return;
    pixelSeen.current = true;
    world.setPixelated?.(ui.pixelated);
  }, [world, ui.pixelated]);
  useEffect(() => {
    if (world && ui.selected !== null) world.focusDistrict?.(ui.selected);
  }, [world, ui.selected]);
  useEffect(() => {
    if (!world || ui.navigation === 0) return;
    window.history.replaceState(window.history.state, '', withSector(window.location.href, ui.sector));
    if (world.setSector?.(ui.sector) === false) {
      setToast(world.walkState?.() === 'failed' ? SUIT_FAILED : SUIT_LOADING);
      dispatch({ type: 'walk', on: false });
    }
    // Only navigations move the camera; other sector changes come from the world itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, ui.navigation]);

  // v1's global keys.
  useEffect(() => {
    const keys = createKeys({
      context: () => {
        const s = uiRef.current;
        return {
          panelOpen: s.panel !== null,
          walking: s.walking,
          flyOnCanvas: s.fly && document.activeElement === canvasRef.current,
          tracing: s.tracing,
          sector: s.sector,
        };
      },
      projects: () => dispatch({ type: 'panel', panel: 'districts' }),
      go: target => dispatch({ type: 'go', sector: target }),
      pause: () => dispatch({ type: 'togglePause' }),
      override: () => {},
    });
    const onKey = (e: KeyboardEvent) => keys.down(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Free flight: the keys fly while the canvas has focus.
  useEffect(() => {
    if (!ui.fly || !world) return;
    const held = new Set<string>();
    const sync = () => {
      const input = { forward: 0, right: 0, up: 0 };
      for (const code of held) {
        const [axis, sign] = FLY_KEYS[code];
        input[axis] += sign;
      }
      world.setFlyInput?.(input);
    };
    const down = (e: KeyboardEvent) => {
      if (document.activeElement !== canvasRef.current || !FLY_KEYS[e.code]) return;
      e.preventDefault();
      held.add(e.code);
      sync();
    };
    const up = (e: KeyboardEvent) => {
      if (held.delete(e.code)) sync();
    };
    const clear = () => {
      held.clear();
      sync();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [ui.fly, world]);

  // Temporary lift hint until the walking controls land: what the L key would do right now.
  const [liftHint, setLiftHint] = useState<string | null>(null);
  useEffect(() => {
    if (!ui.walking) return setLiftHint(null);
    const id = window.setInterval(() => {
      const s = worldRef.current?.liftStatus?.();
      setLiftHint(!s || s.label === 'LMS lift · locating…' ? null : s.available ? `L · ${s.label}` : s.label);
    }, 200);
    return () => window.clearInterval(id);
  }, [ui.walking]);

  const [shareCopied, setShareCopied] = useState(false);
  useEffect(() => {
    if (!shareCopied) return;
    const id = window.setTimeout(() => setShareCopied(false), COPIED_MS);
    return () => window.clearTimeout(id);
  }, [shareCopied]);
  const share = async () => {
    const url = shareUrl(window.location.href, ui.sector);
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
    } catch {
      setToast(`Share this location: ${url}`);
    }
  };

  const act = (a: UiAction) => dispatch(a);
  const enterWalk = () => {
    const world = worldRef.current;
    if (!world) return;
    if (world.setMode('walk')) act({ type: 'walk', on: true });
    else setToast(world.walkState?.() === 'failed' ? SUIT_FAILED : SUIT_LOADING);
  };

  // Postcard mode is as ready as the page will get: the boot line goes, the interface stays.
  const ready = world !== null || postcard;
  const selectedDistrict = DISTRICTS.find(d => d.id === ui.selected) ?? null;
  const classes = [
    'world-shell immersive-world is-exploring',
    ui.walking && 'is-walking',
    ready && 'is-ready',
    ui.night ? 'night' : 'dawn',
    ui.pixelated && 'pixelated',
  ].filter(Boolean);
  const closePanel = () => act({ type: 'panel', panel: null });

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
      <Location sector={ui.sector} />
      <Utilities
        night={ui.night}
        paused={ui.paused}
        pauseLocked={ui.tracing}
        sound={ui.sound}
        shareCopied={shareCopied}
        onNight={() => act({ type: 'toggleNight' })}
        onPause={() => act({ type: 'togglePause' })}
        onSound={() => act({ type: 'toggleSound' })}
        onShare={share}
      >
        <PhotoPanel world={world} canvas={canvasRef.current} onChange={on => act({ type: 'trace', on })} />
      </Utilities>
      <Guidance
        text={guidanceText({ tracing: ui.tracing, hover, fly: ui.fly, tour: ui.tour })}
        hovered={!ui.tracing && hover !== null}
      />
      <footer className="world-interface">
        <Credit onBuilder={() => act({ type: 'panel', panel: 'author' })} />
        <Dock
          walkDisabled={world === null}
          orbitActive={ui.sector === 'overview' && ui.panel === null}
          districts={DISTRICTS.length}
          found={0}
          onOrbit={() => act({ type: 'go', sector: 'overview' })}
          onWalk={enterWalk}
          onProjects={() => act({ type: 'panel', panel: 'districts' })}
          onDiscoveries={() => act({ type: 'panel', panel: 'signals' })}
          onHelp={() => act({ type: 'panel', panel: 'help' })}
        />
      </footer>
      {selectedDistrict && <Inspector district={selectedDistrict} onClose={() => act({ type: 'select', id: null })} />}
      <Toast text={toast} />
      {liftHint && <p className="world-hint">{liftHint}</p>}
      {ui.panel === 'districts' && <ProjectsPanel onSelect={id => act({ type: 'select', id })} onClose={closePanel} />}
      {ui.panel === 'signals' && <DiscoveriesPanel found={[]} onClose={closePanel} />}
      {ui.panel === 'author' && (
        <BuilderPanel onMaintenance={() => act({ type: 'go', sector: 'underworld' })} onClose={closePanel} />
      )}
      {ui.panel === 'help' && (
        <HelpPanel
          sector={ui.sector}
          pixelated={ui.pixelated}
          fly={ui.fly}
          actions={{
            tour: () => act({ type: 'startTour' }),
            street: () => act({ type: 'go', sector: otherSector(ui.sector) }),
            pixel: () => act({ type: 'togglePixel' }),
            fly: () => {
              // v1 toasted on the way out of free flight too.
              if (!ui.fly) setToast(FREE_FLIGHT);
              act({ type: 'toggleFly' });
            },
          }}
          onClose={closePanel}
        />
      )}
    </main>
  );
}
