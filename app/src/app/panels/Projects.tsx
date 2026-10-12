import { ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import { DISTRICTS, type District } from '../../content/districts';
import { Panel } from './Panel';

const FILTERS = {
  all: () => true,
  production: (d: District) => d.production === true,
  'public repositories': (d: District) => !d.production && !d.research,
} as const;
type Filter = keyof typeof FILTERS;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The district's badge: LIVE, LAB, or the repository's language. */
export function districtType(d: District): string {
  return d.production ? 'LIVE' : d.research ? 'LAB' : (d.language ?? 'CODE');
}

export function ProjectsPanel({ onSelect, onClose }: { onSelect(id: number): void; onClose(): void }) {
  const [filter, setFilter] = useState<Filter>('all');
  const list = DISTRICTS.filter(FILTERS[filter]);
  return (
    <Panel
      className="directory-panel"
      eyebrow={`${pad2(DISTRICTS.length)} ADDRESSES · ONE CONNECTED WORLD`}
      title="Explore the projects."
      onClose={onClose}
    >
      <p className="panel-description">Every building has a purpose. Choose an address to get closer.</p>
      <div className="filter-tabs">
        {(Object.keys(FILTERS) as Filter[]).map(f => (
          <button key={f} className={f === filter ? 'active' : ''} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      <div className="district-list">
        {list.map((d, i) => (
          <button key={d.id} className="district-row" onClick={() => onSelect(d.id)}>
            <span className="district-number">{pad2(i + 1)}</span>
            <span className="district-swatch" style={{ background: d.color }} />
            <span className="district-row-title">
              <strong>{d.displayName ?? d.name}</strong>
              <small>{d.impact ?? d.name}</small>
            </span>
            <span className={`district-type${d.production ? ' live' : ''}`}>{districtType(d)}</span>
            <ArrowUpRight size={16} />
          </button>
        ))}
      </div>
      {/* v1 formatted the snapshot date in the viewer's time zone; this is its UTC reading. */}
      <p className="data-note">Public repository snapshot · 04 Sept 2026. Production impact supplied by the builder.</p>
    </Panel>
  );
}
