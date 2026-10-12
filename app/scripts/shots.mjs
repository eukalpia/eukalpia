// Visual shot harness: builds are served with `vite preview`, rendered in headless Chromium
// (SwiftShader), and checked for console errors, shader failures and frame budgets.
//
// Usage: node scripts/shots.mjs [--quality=high|medium|low] [--no-webgl] [--size=WxH] <shot...>
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-results', 'shots');
const port = 4173;
const base = `http://localhost:${port}/eukalpia/`;

const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const quality = flag('quality') ?? 'high';
const [width, height] = (flag('size') ?? '1280x720').split('x').map(Number);
const noWebgl = args.includes('--no-webgl');
const shots = args.filter(a => !a.startsWith('--'));
const failures = [];

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('vite preview did not start');
}

const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const browserArgs = noWebgl
  ? ['--disable-webgl', '--disable-3d-apis']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

try {
  await waitForServer();
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: browserArgs });
  const context = await browser.newContext({ viewport: { width, height } });

  if (noWebgl) {
    const page = await context.newPage();
    await page.goto(base);
    const visible = await page.locator('img[alt^="A captured view"]').isVisible({ timeout: 15000 }).catch(() => false);
    if (!visible) failures.push('no-webgl: postcard fallback is not visible');
    else console.log('no-webgl: postcard fallback visible');
  }

  const stats = {};
  for (const shot of noWebgl ? [] : shots) {
    const page = await context.newPage();
    const errors = [];
    page.on('console', m => {
      const text = m.text();
      if (m.type() === 'error' || text.includes('THREE.WebGLProgram')) errors.push(text.slice(0, 600));
    });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    const time = shot.includes('night') ? 'night' : 'day';
    const started = Date.now();
    await page.goto(`${base}?shot=${shot}&time=${time}&quality=${quality}`);
    await page.waitForFunction(() => window.__eukalpia?.ready && window.__eukalpia.frame >= 12, null, { timeout: 240000, polling: 500 });
    const file = join(outDir, `${shot}${quality === 'high' ? '' : `-${quality}`}.png`);
    await page.screenshot({ path: file });
    const s = await page.evaluate(() => window.__eukalpia.stats());
    s.seconds = Math.round((Date.now() - started) / 100) / 10;
    stats[shot] = s;
    console.log(`${shot}: ${s.drawCalls} calls, ${s.triangles} tris, dpr ${s.dpr}, ${s.seconds}s → ${file}`);
    if (!s.withinBudget) failures.push(`${shot}: over budget (${s.drawCalls}/${s.budget.drawCalls} calls, ${s.triangles}/${s.budget.triangles} tris)`);

    // The render loop must pause while the tab is hidden.
    const paused = await page.evaluate(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(r => setTimeout(r, 300));
      const before = window.__eukalpia.frame;
      await new Promise(r => setTimeout(r, 1000));
      const after = window.__eukalpia.frame;
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
      return before === after;
    });
    if (!paused) failures.push(`${shot}: render loop kept running while hidden`);

    for (const e of errors) failures.push(`${shot}: ${e}`);
    await page.close();
  }
  if (!noWebgl) await writeFile(join(outDir, `stats${quality === 'high' ? '' : `-${quality}`}.json`), JSON.stringify(stats, null, 2));
  await browser.close();
} finally {
  server.kill();
}

if (failures.length) {
  console.error('FAILED:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('OK');
