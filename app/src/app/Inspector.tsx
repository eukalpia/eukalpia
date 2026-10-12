import { ArrowUpRight, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { District } from '../content/districts';

function eyebrow(d: District) {
  return d.production ? '● IN PRODUCTION' : d.research ? 'SPEECH INTELLIGENCE LAB' : 'PUBLIC REPOSITORY';
}

function summary(d: District) {
  if (d.impact) return d.impact;
  return `${d.language ?? 'Experimental'} · ${d.stars} ${d.stars === 1 ? 'star' : 'stars'}`;
}

function cta(d: District) {
  if (d.privateProject) return 'DISCUSS THIS PROJECT';
  if (d.production) return 'VISIT PLATFORM';
  if (d.research) return 'READ THE UNIVERSITY FEATURE';
  return 'OPEN REPOSITORY';
}

/** The card for the selected district; it takes focus each time a district is chosen. */
export function Inspector({ district, onClose }: { district: District; onClose(): void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), [district.id]);
  const title = district.displayName ?? district.name;
  return (
    <aside ref={ref} className="district-inspector" tabIndex={-1} aria-label={title}>
      <button className="inspector-close icon-button" aria-label="Close district details" onClick={onClose}>
        <X size={16} />
      </button>
      <span className="eyebrow">{eyebrow(district)}</span>
      <h2>{title}</h2>
      <p>{summary(district)}</p>
      <span className="district-address">{district.name}</span>
      {district.capabilities && (
        <ul className="project-capabilities">
          {district.capabilities.map(c => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <a className="visit-button" href={district.url} target="_blank" rel="noreferrer">
        {cta(district)}
        <ArrowUpRight size={17} />
      </a>
    </aside>
  );
}
