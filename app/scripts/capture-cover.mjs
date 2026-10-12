// Captures the README cover, the social preview (og.png) and the no-WebGL postcard from a built site.
// Frames are drawn one at a time with a fixed step of city time, so clouds and air traffic move smoothly
// however slowly the headless renderer works.
//
// Usage: npm run build && node scripts/capture-cover.mjs [--port=N] [--frames=N] [--seconds=S] [--only=cover|stills]
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { checkCover, coverSvg, MAX_COVER_BYTES } from './cover.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const port = Number(flag('port') ?? 4185);
const frames = Number(flag('frames') ?? 90);
const seconds = Number(flag('seconds') ?? 7.5);
const only = flag('only');
const base = `http://localhost:${port}/eukalpia/`;
const samples = join(root, 'test-results', 'cover');
/** Some headroom under the limit CI enforces. */
const COVER_TARGET_BYTES = MAX_COVER_BYTES * 0.95;

const TARGET = [0, 60, 0];
/** A point on a sphere around the city's centre: azimuth from +z towards +x, polar from straight up. */
function around(distance, polar, azimuth, target = TARGET) {
  return [
    target[0] + distance * Math.sin(polar) * Math.sin(azimuth),
    target[1] + distance * Math.cos(polar),
    target[2] + distance * Math.sin(polar) * Math.cos(azimuth),
  ];
}
const ease = t => t * t * (3 - 2 * t);
/** The cover: a slow arc around the city, easing in a little closer. */
function coverPose(t) {
  const e = ease(t);
  const target = [0, 22 + 8 * e, 0];
  return { position: around(1160 - 90 * e, 1.2 + 0.03 * e, 0.5 + 0.42 * t, target), target };
}
/** The social preview and the postcard: the middle of the cover arc. */
const HERO = coverPose(0.5);

async function startPreview() {
  const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: 'ignore',
  });
  let exited = false;
  server.on('exit', () => (exited = true));
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error(`vite preview exited; is port ${port} already in use?`);
    try {
      if ((await fetch(base)).ok) return server;
    } catch (error) {
      if (error?.cause?.message === 'bad port') throw new Error(`port ${port} is blocked by fetch; use another --port`);
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('vite preview did not start');
}

const capture = (page, request) => page.evaluate(r => window.__eukalpia.capture(r), request);
const base64Of = dataUrl => dataUrl.slice(dataUrl.indexOf(',') + 1);

async function openCity(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', e => console.error(`pageerror: ${e.message}`));
  await page.goto(`${base}?shot=orbit-day&time=day&quality=high`);
  await page.waitForFunction(() => window.__eukalpia?.ready && window.__eukalpia.frame >= 12, null, {
    timeout: 240000,
    polling: 500,
  });
  await page.evaluate(() => window.__eukalpia.hold(true));
  return page;
}

const server = await startPreview();
try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  await mkdir(samples, { recursive: true });

  if (only !== 'stills') {
    const page = await openCity(browser, 960, 540);
    const dt = seconds / frames;
    // A few frames to settle exposure and shadows at the first pose.
    for (let i = 0; i < 4; i++) await capture(page, { dt, ...coverPose(0), type: 'image/png' });
    // Frames are kept lossless, then encoded at the best WebP quality that keeps the cover within budget.
    const started = Date.now();
    for (let i = 0; i < frames; i++) {
      // Kept in the page: 90 lossless frames are too heavy to ship back and forth.
      await page.evaluate(
        async r => {
          (window.__coverFrames ??= []).push(await window.__eukalpia.capture(r));
        },
        { dt, ...coverPose(i / frames), type: 'image/png' },
      );
      if (i % 10 === 9) console.log(`cover: ${i + 1}/${frames} frames, ${Math.round((Date.now() - started) / 1000)}s`);
    }
    let svg = '';
    for (const quality of [0.8, 0.74, 0.68, 0.62, 0.56, 0.5]) {
      const webps = await page.evaluate(async quality => {
        const canvas = document.createElement('canvas');
        const g = canvas.getContext('2d');
        const out = [];
        for (const src of window.__coverFrames) {
          const img = new Image();
          img.src = src;
          await img.decode();
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          g.drawImage(img, 0, 0);
          out.push(canvas.toDataURL('image/webp', quality));
        }
        return out;
      }, quality);
      svg = coverSvg(
        webps.map(url => ({ mime: 'image/webp', base64: base64Of(url) })),
        {
          width: 960,
          height: 540,
          seconds,
          title: 'A floating 3D city',
          description: `${frames} rendered views of the interactive city. Follow the surrounding link to enter the live world. Reduced motion and static viewers show the first captured frame.`,
        },
      );
      console.log(`cover: WebP quality ${quality} → ${(Buffer.byteLength(svg) / 1048576).toFixed(2)} MB`);
      if (Buffer.byteLength(svg) <= COVER_TARGET_BYTES) {
        for (const i of [0, frames >> 1, frames - 1])
          await writeFile(join(samples, `frame-${i}.webp`), Buffer.from(base64Of(webps[i]), 'base64'));
        break;
      }
    }
    const problems = checkCover(svg);
    if (problems.length) throw new Error(`the cover would fail CI: ${problems.join('; ')}`);
    const file = join(root, '..', 'public', 'profile-cover.svg');
    await writeFile(file, svg);
    console.log(`cover: ${(Buffer.byteLength(svg) / 1048576).toFixed(2)} MB → ${file}`);
    await page.close();
  }

  if (only !== 'cover') {
    for (const still of [
      { file: join(root, 'public', 'og.png'), width: 1200, height: 630, type: 'image/png' },
      {
        file: join(root, 'public', 'city-cinematic.webp'),
        width: 1440,
        height: 810,
        type: 'image/webp',
        quality: 0.86,
      },
    ]) {
      const page = await openCity(browser, still.width, still.height);
      for (let i = 0; i < 4; i++) await capture(page, { dt: 1 / 30, ...HERO, type: 'image/png' });
      const url = await capture(page, { dt: 1 / 30, ...HERO, type: still.type, quality: still.quality });
      await writeFile(still.file, Buffer.from(base64Of(url), 'base64'));
      console.log(`still: ${still.width}×${still.height} → ${still.file}`);
      await page.close();
    }
  }
  await browser.close();
} finally {
  server.kill();
}
