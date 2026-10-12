import {
  ArrowUpRight,
  Check,
  CircleQuestionMark,
  Compass,
  Copy,
  Footprints,
  Map as MapIcon,
  Moon,
  Pause,
  Play,
  Radio,
  Sun,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { BUILDER } from '../content/builder';
import type { Sector } from './url';

/** The persistent v1 chrome around the canvas: boot line, location, utilities, guidance, credit and dock. */

export function Boot() {
  return (
    <div className="boot-message">
      <span className="boot-block" /> ASSEMBLING THE WORLD<span className="boot-dots">...</span>
    </div>
  );
}

const SECTORS: Record<Sector, [string, string]> = {
  overview: ['THE FLOATING CITY', '000'],
  street: ['THE LIVING QUARTER', '001'],
  underworld: ['BELOW THE SURFACE', '-01'],
};

export function Location({ sector }: { sector: Sector }) {
  const [title, code] = SECTORS[sector];
  return (
    <div className="world-location">
      <span className="status-dot" />
      <span>{title}</span>
      <span className="world-sector">{code}</span>
    </div>
  );
}

export interface UtilitiesProps {
  night: boolean;
  paused: boolean;
  pauseLocked: boolean;
  sound: boolean;
  shareCopied: boolean;
  onNight(): void;
  onPause(): void;
  onSound(): void;
  onShare(): void;
  /** The Ray Tracing toggle and its panel hang under the bar. */
  children?: ReactNode;
}

function Utility(props: { label: string; active?: boolean; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button
      className={`world-utility${props.active ? ' active' : ''}`}
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

export function Utilities(p: UtilitiesProps) {
  return (
    <div className="world-utilities" role="group" aria-label="World settings">
      <Utility label={p.night ? 'Switch to daylight' : 'Switch to night'} onClick={p.onNight}>
        {p.night ? <Moon size={17} /> : <Sun size={17} />}
      </Utility>
      <Utility label={p.paused ? 'Resume motion' : 'Pause motion'} disabled={p.pauseLocked} onClick={p.onPause}>
        {p.paused ? <Play size={16} /> : <Pause size={16} />}
      </Utility>
      <Utility label={p.sound ? 'Mute ambient sound' : 'Enable ambient sound'} active={p.sound} onClick={p.onSound}>
        {p.sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
      </Utility>
      <span className="world-utility-divider" />
      <Utility label={p.shareCopied ? 'Location copied' : 'Share this location'} onClick={p.onShare}>
        {p.shareCopied ? <Check size={16} /> : <Copy size={16} />}
      </Utility>
      {p.children}
    </div>
  );
}

/** One hint line: what is under the pointer, or how to move in the current mode. */
export function Guidance({ text, hovered }: { text: string; hovered: boolean }) {
  return (
    <div className="world-guidance" aria-live="off">
      {hovered ? <span className="status-dot" /> : <Compass size={12} />}
      <span>{text}</span>
    </div>
  );
}

export function guidanceText(o: { tracing: boolean; hover: string | null; fly: boolean; tour: boolean }): string {
  if (o.tracing) return 'Ray-traced photo mode · motion paused';
  if (o.hover) return o.hover;
  if (o.fly) return 'W A S D TO FLY · Q / E ALTITUDE · DRAG TO LOOK';
  return o.tour ? 'CINEMATIC TOUR · DRAG TO EXPLORE' : 'DRAG TO ORBIT · SCROLL TO EXPLORE';
}

export function Credit({ onBuilder }: { onBuilder(): void }) {
  return (
    <section className="world-credit" aria-label="The builder">
      <span className="world-credit-label">AN INDEPENDENT WORLD BY</span>
      <h1>
        <button onClick={onBuilder} aria-label={`About ${BUILDER.fullName}`}>
          {BUILDER.name}
          <ArrowUpRight size={16} />
        </button>
      </h1>
      <p>{BUILDER.role}</p>
      <a href={BUILDER.university.url} target="_blank" rel="noreferrer">
        {BUILDER.university.label}
        <ArrowUpRight size={10} />
      </a>
    </section>
  );
}

export interface DockProps {
  /** Until the city is ready, and in postcard mode. */
  walkDisabled: boolean;
  orbitActive: boolean;
  districts: number;
  found: number;
  onOrbit(): void;
  onWalk(): void;
  onProjects(): void;
  onDiscoveries(): void;
  onHelp(): void;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function Dock(p: DockProps) {
  return (
    <nav className="world-dock" aria-label="City navigation">
      <button className={p.orbitActive ? 'active' : ''} aria-label="Return to orbit" onClick={p.onOrbit}>
        <Compass size={18} />
        <span>Orbit</span>
      </button>
      <button aria-label="Walk through the city" disabled={p.walkDisabled} onClick={p.onWalk}>
        <Footprints size={18} />
        <span>Walk</span>
      </button>
      <button aria-label="Explore projects" onClick={p.onProjects}>
        <MapIcon size={18} />
        <span>
          Projects<small>{pad2(p.districts)}</small>
        </span>
      </button>
      <button
        className={p.found === 6 ? 'discoveries-complete' : ''}
        aria-label={`Discoveries, ${p.found} of 6 found`}
        onClick={p.onDiscoveries}
      >
        <Radio size={18} />
        <span>
          Discoveries<small>{p.found}/6</small>
        </span>
      </button>
      <button aria-label="Controls and help" onClick={p.onHelp}>
        <CircleQuestionMark size={18} />
        <span>Help</span>
      </button>
    </nav>
  );
}

/** The shared message slot at the bottom centre; empty when idle. */
export function Toast({ text }: { text: string }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      {text && (
        <>
          <Radio size={16} />
          <span>{text}</span>
        </>
      )}
    </div>
  );
}

/** v1's greeting in the browser console, printed once per mount. */
export function greetConsole() {
  console.info('%cA TRANSMISSION FROM THE FLOATING CITY', 'color:#e2b183;font-size:16px;font-family:monospace');
  console.info('65 75 6b 61 6c 70 69 61\nA small beacon carries this name. Find its glow between the buildings.');
}
