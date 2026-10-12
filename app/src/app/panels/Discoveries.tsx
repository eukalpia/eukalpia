import { Check, ChevronRight, Compass, ScanLine } from 'lucide-react';
import { SIGNAL_ORDER, SIGNALS, type SignalId } from '../../content/signals';
import { Panel } from './Panel';

export function DiscoveriesPanel({ found, onClose }: { found: readonly SignalId[]; onClose(): void }) {
  const complete = SIGNAL_ORDER.every(id => found.includes(id));
  return (
    <Panel
      className="signals-panel"
      eyebrow={`${found.length} OF 6 DISCOVERIES`}
      title={complete ? 'The city remembers you.' : 'Look a little closer.'}
      onClose={onClose}
    >
      <p className="panel-description">
        {complete
          ? 'You looked a little closer. You stayed a little longer. This world is better with you in it.'
          : 'Six small secrets live in this world. No leaderboard. No rush. Your discoveries stay on this device.'}
      </p>
      <div className="signal-grid">
        {SIGNAL_ORDER.map((id, i) => {
          const isFound = found.includes(id);
          return (
            <details key={id} className={`signal${isFound ? ' found' : ''}`}>
              <summary>
                <span>{String(i + 1).padStart(2, '0')}</span>
                {isFound ? <Check size={17} /> : <ScanLine size={17} />}
                <strong>{isFound ? SIGNALS[id].name : 'Unknown signal'}</strong>
                <ChevronRight size={14} />
              </summary>
              <p>{isFound ? SIGNALS[id].message : SIGNALS[id].hint}</p>
            </details>
          );
        })}
      </div>
      <button className="wide-link" onClick={onClose}>
        Back to exploring
        <Compass size={17} />
      </button>
    </Panel>
  );
}
