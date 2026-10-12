import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { parseShotParams } from './engine/debug';
import './styles.css';

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const params = parseShotParams(window.location.search);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      quality={params.quality ?? 'high'}
      initialTime={params.time ?? (params.shot === 'orbit-night' ? 'night' : 'day')}
      shot={params.shot}
      reducedMotion={reducedMotion}
      webgl2={supportsWebGL2()}
    />
  </StrictMode>,
);
