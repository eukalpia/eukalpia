import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coverSvg } from '../scripts/cover.mjs';
import { checkRelease, REQUIRED_FILES } from '../scripts/check-release.mjs';

const frame = { mime: 'image/webp', base64: 'AAAA' };
const goodCover = coverSvg([frame, frame], { width: 4, height: 2, seconds: 1, title: 't', description: 'd' });

function release(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, 'dist', name, '..'), { recursive: true });
    writeFileSync(join(dir, 'dist', name), body);
  }
  writeFileSync(join(dir, 'cover.svg'), goodCover);
  return { dist: join(dir, 'dist'), cover: join(dir, 'cover.svg') };
}
const complete = () => Object.fromEntries([...REQUIRED_FILES, 'assets/index-abc.js'].map(f => [f, 'x']));

test('a complete build with a valid cover passes', () => {
  expect(REQUIRED_FILES).toEqual([
    'index.html',
    'favicon.svg',
    'og.png',
    'city-cinematic.webp',
    'THIRD-PARTY-NOTICES.txt',
  ]);
  const r = release(complete());
  expect(checkRelease(r.dist, r.cover)).toEqual([]);
});

test('source maps, a missing file or a cover CI would refuse each fail the release', () => {
  const withMap = release({ ...complete(), 'assets/index-abc.js.map': '{}' });
  expect(checkRelease(withMap.dist, withMap.cover).join()).toMatch(/source map.*index-abc\.js\.map/);
  const { 'og.png': _, ...rest } = complete();
  const missing = release(rest);
  expect(checkRelease(missing.dist, missing.cover).join()).toMatch(/og\.png/);
  const badCover = release(complete());
  writeFileSync(badCover.cover, goodCover.replace('step-end', 'linear'));
  expect(checkRelease(badCover.dist, badCover.cover).join()).toMatch(/cover.*step-end/);
});

test('the Pages workflow tests and builds app/, checks the release and publishes app/dist', () => {
  const yml = readFileSync(join(process.cwd(), '..', '.github', 'workflows', 'pages.yml'), 'utf8');
  for (const step of [
    'npm ci',
    'npm test',
    'npm run build',
    'node scripts/check-release.mjs dist ../public/profile-cover.svg',
  ])
    expect(yml).toContain(step);
  expect(yml).toMatch(/working-directory: app/);
  expect(yml).toMatch(/path: app\/dist/);
  expect(yml).not.toMatch(/site\//);
});
