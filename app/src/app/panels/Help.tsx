import {
  ArrowDown,
  ArrowUpRight,
  AudioLines,
  Compass,
  Grid2x2,
  Map as MapIcon,
  MoveUpRight,
  Pause,
  Radio,
} from 'lucide-react';
import type { Sector } from '../url';
import { Panel } from './Panel';

export interface HelpActions {
  tour(): void;
  street(): void;
  pixel(): void;
  fly(): void;
}

export interface HelpProps {
  sector: Sector;
  pixelated: boolean;
  fly: boolean;
  actions: HelpActions;
  onClose(): void;
}

export function HelpPanel({ sector, pixelated, fly, actions, onClose }: HelpProps) {
  return (
    <Panel className="help-panel" eyebrow="A FEW WAYS TO EXPLORE" title="Make yourself at home." onClose={onClose}>
      <div className="help-list">
        <p>
          <Compass />
          <span>Drag to orbit the city. Scroll or pinch to zoom. Click a building to meet its project.</span>
        </p>
        {/* v1 laid this row out as loose flex items around the kbds; here it reads as one sentence. */}
        <p>
          <MapIcon />
          <span>
            Projects opens every district with keyboard or touch. Press <kbd>D</kbd> for the directory and <kbd>E</kbd>{' '}
            to switch between orbit and street level.
          </span>
        </p>
        <p>
          <Radio />
          <span>Six discoveries reward a closer look. Open Discoveries whenever you would like a hint.</span>
        </p>
        <p>
          <Pause />
          <span>Pause ambient motion at any time. Reduced-motion settings are respected.</span>
        </p>
        <p>
          <AudioLines />
          <span>Sound is optional and starts only when you switch it on.</span>
        </p>
        <p>
          <ArrowDown />
          <span>Even floating cities have roots. Some doors open when you know where to look.</span>
        </p>
      </div>
      <div className="world-help-actions">
        <button onClick={actions.tour}>
          <Compass size={16} />
          Start cinematic tour
          <ArrowUpRight size={14} />
        </button>
        <button onClick={actions.street}>
          <MapIcon size={16} />
          {sector === 'street' ? 'Return to orbit' : 'Explore street level'}
          <ArrowUpRight size={14} />
        </button>
        <button aria-pressed={pixelated} onClick={actions.pixel}>
          <Grid2x2 size={16} />
          Pixel vision
          <span>{pixelated ? 'ON' : 'OFF'}</span>
        </button>
      </div>
      <button className="wide-link" onClick={actions.fly}>
        {fly ? 'Exit free flight' : 'Enable free flight (keyboard)'}
        <MoveUpRight size={17} />
      </button>
    </Panel>
  );
}
