// Visual shot harness: builds are served with `vite preview`, rendered in headless Chromium
// (SwiftShader), and checked for console errors, shader failures and frame budgets.
//
// Usage: node scripts/shots.mjs [--quality=high|medium|low] [--no-webgl] [--no-float] [--photo=N] [--size=WxH] [--port=N] <shot...>
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'test-results', 'shots');
const port = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] ?? 4173);
const base = `http://localhost:${port}/eukalpia/`;

const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const quality = flag('quality') ?? 'high';
const [width, height] = (flag('size') ?? '1280x720').split('x').map(Number);
const noWebgl = args.includes('--no-webgl');
// --photo=N: after each shot, enter photo mode and capture the frame once N samples have accumulated.
const photoSamples = Number(flag('photo') ?? 0);
// --no-float: hide EXT_color_buffer_float and check that photo mode refuses with a clear message.
const noFloat = args.includes('--no-float');
const timeOverride = flag('time');
const debugFlags = flag('debug');
const shots = args.filter(a => !a.startsWith('--'));
const failures = [];

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    // A preview server that exits at once means the port is taken by another server.
    if (serverExited) throw new Error(`vite preview exited; is port ${port} already in use?`);
    try {
      if ((await fetch(base)).ok) return;
    } catch (error) {
      // fetch refuses the ports on the WHATWG blocklist (e.g. 4190) before it even connects.
      if (error?.cause?.message === 'bad port') throw new Error(`port ${port} is blocked by fetch; use another --port`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('vite preview did not start');
}

// Run vite directly, not through npx, so that killing `server` really stops the preview server.
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
let serverExited = false;
server.on('exit', () => (serverExited = true));
const browserArgs = noWebgl
  ? ['--disable-webgl', '--disable-3d-apis']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

try {
  await waitForServer();
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    args: browserArgs,
  });
  const context = await browser.newContext({ viewport: { width, height } });

  if (noWebgl) {
    const page = await context.newPage();
    await page.goto(base);
    const visible = await page
      .locator('img[alt^="A captured view"]')
      .isVisible({ timeout: 15000 })
      .catch(() => false);
    if (!visible) failures.push('no-webgl: postcard fallback is not visible');
    else console.log('no-webgl: postcard fallback visible');
  }

  if (noFloat) {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const original = WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension = function (name) {
        return name === 'EXT_color_buffer_float' ? null : original.call(this, name);
      };
    });
    await page.goto(`${base}?shot=orbit-day&quality=${quality}`);
    await page.waitForFunction(() => window.__eukalpia?.ready && window.__eukalpia.frame >= 12, null, {
      timeout: 240000,
      polling: 500,
    });
    await page.getByRole('button', { name: /^Ray Tracing/ }).click();
    const alert = await page
      .getByRole('alert')
      .textContent({ timeout: 30000 })
      .catch(() => '');
    const frame = await page.evaluate(() => window.__eukalpia.frame);
    await page.waitForTimeout(5000);
    const still = await page.evaluate(f => window.__eukalpia.frame > f, frame);
    const button = await page.getByRole('button', { name: /^Ray Tracing/ }).isVisible();
    if (!alert.includes('EXT_color_buffer_float')) failures.push(`no-float: no refusal message (got "${alert}")`);
    else if (!button || !still)
      failures.push(
        `no-float: the normal view did not come back (Ray Tracing toggle ${button}, frames advancing ${still})`,
      );
    else console.log(`no-float: "${alert}"`);
    for (const e of errors) failures.push(`no-float: ${e}`);
    await page.close();
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
    const time = timeOverride ?? (shot.includes('night') ? 'night' : 'day');
    const started = Date.now();
    await page.goto(`${base}?shot=${shot}&time=${time}&quality=${quality}${debugFlags ? `&debug=${debugFlags}` : ''}`);
    await page.waitForFunction(() => window.__eukalpia?.ready && window.__eukalpia.frame >= 12, null, {
      timeout: 240000,
      polling: 500,
    });
    if (shot.startsWith('character')) {
      // UR-01 must keep the proportions of its GLB: 1.824 m ±1 %, width/height and depth/height ±2 %.
      await page.waitForFunction(() => !!window.__eukalpia.character, null, { timeout: 180000, polling: 500 });
      const frameAtLoad = await page.evaluate(() => window.__eukalpia.frame);
      await page.waitForFunction(f => window.__eukalpia.frame >= f + 6, frameAtLoad, { timeout: 120000, polling: 500 });
      const m = await page.evaluate(() => window.__eukalpia.character());
      const off = (v, ref) => Math.abs(v - ref) / ref;
      console.log(
        `${shot}: UR-01 ${m.height.toFixed(3)} m, w/h ${m.widthRatio.toFixed(4)}, d/h ${m.depthRatio.toFixed(4)}`,
      );
      if (off(m.height, 1.824) > 0.01) failures.push(`${shot}: UR-01 height ${m.height} is not 1.824 m ±1 %`);
      if (off(m.widthRatio, 0.4691) > 0.02)
        failures.push(`${shot}: UR-01 width/height ${m.widthRatio} is not 0.469 ±2 %`);
      if (off(m.depthRatio, 0.1993) > 0.02)
        failures.push(`${shot}: UR-01 depth/height ${m.depthRatio} is not 0.199 ±2 %`);
    }
    const file = join(
      outDir,
      `${shot}${timeOverride ? `-${timeOverride}` : ''}${debugFlags ? `-${debugFlags.replaceAll(',', '-')}` : ''}${quality === 'high' ? '' : `-${quality}`}.png`,
    );
    await page.screenshot({ path: file, timeout: 180000 });
    const s = await page.evaluate(() => window.__eukalpia.stats());
    s.seconds = Math.round((Date.now() - started) / 100) / 10;
    stats[shot] = s;
    console.log(`${shot}: ${s.drawCalls} calls, ${s.triangles} tris, dpr ${s.dpr}, ${s.seconds}s → ${file}`);
    if (!s.withinBudget)
      failures.push(
        `${shot}: over budget (${s.drawCalls}/${s.budget.drawCalls} calls, ${s.triangles}/${s.budget.triangles} tris)`,
      );

    if (photoSamples > 0) {
      const t0 = Date.now();
      const entered = await page.evaluate(() => window.__eukalpia.photo.enter());
      if (!entered.ok) failures.push(`${shot}: photo mode refused: ${entered.message}`);
      else {
        const built = Math.round((Date.now() - t0) / 100) / 10;
        await page.waitForFunction(n => (window.__eukalpia.photo.status()?.samples ?? 0) >= n, photoSamples, {
          timeout: 150 * 60 * 1000,
          polling: 5000,
        });
        const photoFile = file.replace(/\.png$/, `-photo${photoSamples}.png`);
        // The traced frame alone: an element screenshot is a crop of the page, so hide the interface.
        await page.addStyleTag({
          content: 'body * { visibility: hidden !important } canvas { visibility: visible !important }',
        });
        await page.locator('canvas').screenshot({ path: photoFile, timeout: 180000 });
        const triangles = await page.evaluate(() => window.__eukalpia.photo.triangles());
        s.photo = {
          samples: photoSamples,
          buildSeconds: built,
          seconds: Math.round((Date.now() - t0) / 100) / 10,
          triangles,
        };
        console.log(
          `${shot}: photo ${photoSamples} samples in ${s.photo.seconds}s (scene ${built}s, ${triangles} tris) → ${photoFile}`,
        );
        if (triangles > 3_000_000) failures.push(`${shot}: photo scene has ${triangles} triangles (budget 3 M)`);
      }
    }

    // Resizing must resize the drawing buffer (composer, shadows and camera follow it).
    await page.setViewportSize({ width: 900, height: 900 });
    const resized = await page.evaluate(async () => {
      const start = window.__eukalpia.frame;
      while (window.__eukalpia.frame < start + 3) await new Promise(r => setTimeout(r, 100));
      const canvas = document.querySelector('canvas');
      const dpr = window.__eukalpia.stats().dpr;
      return canvas.width === Math.round(900 * dpr) && canvas.height === Math.round(900 * dpr);
    });
    if (!resized) failures.push(`${shot}: canvas did not follow a 900×900 resize`);
    await page.setViewportSize({ width, height });

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
  if (!noWebgl)
    await writeFile(
      join(
        outDir,
        `stats${quality === 'high' ? '' : `-${quality}`}${photoSamples ? `-photo-${shots.join('-')}` : ''}.json`,
      ),
      JSON.stringify(stats, null, 2),
    );
  await browser.close();
} finally {
  server.kill();
}

if (failures.length) {
  console.error('FAILED:\n' + failures.join('\n'));
  process.exit(1);
}
console.log('OK');
