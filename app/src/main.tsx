import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { parseShotParams } from './engine/debug';
import { parseSector } from './app/url';
import { detectTier, readDeviceInfo } from './engine/quality';
import './styles.css';

/** Probes WebGL2 and reads the GPU name for tier selection. */
function probeGpu(): { webgl2: boolean; renderer: string } {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false, renderer: '' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return { webgl2: true, renderer };
  } catch {
    return { webgl2: false, renderer: '' };
  }
}

const params = parseShotParams(window.location.search);
const gpu = probeGpu();
const tier = detectTier(
  readDeviceInfo({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    hardwareConcurrency: navigator.hardwareConcurrency,
    renderer: gpu.renderer,
    screenArea: window.screen.width * window.screen.height,
  }),
);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App
      quality={params.quality ?? tier}
      initialTime={params.time ?? (params.shot?.endsWith('-night') ? 'night' : 'day')}
      shot={params.shot}
      reducedMotion={reducedMotion}
      webgl2={gpu.webgl2}
      debug={params.debug}
      sector={parseSector(window.location.search)}
    />
  </StrictMode>,
);
