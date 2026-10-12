import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkCover, coverSvg, MAX_COVER_BYTES } from '../scripts/cover.mjs';

const frame = (n: number) => ({ mime: 'image/webp', base64: Buffer.from(`frame ${n}`).toString('base64') });
const options = {
  width: 960,
  height: 540,
  seconds: 7.5,
  title: 'A floating 3D city',
  description: 'Rendered views of the interactive city & its <streets>.',
};

test('the README cover in the repository passes the check CI runs', () => {
  const svg = readFileSync(join(process.cwd(), '..', 'public', 'profile-cover.svg'), 'utf8');
  expect(checkCover(svg)).toEqual([]);
});

test('a cover built from frames passes, shows frame 0 when still, and steps through each frame in turn', () => {
  const svg = coverSvg([frame(0), frame(1), frame(2)], options);
  expect(checkCover(svg)).toEqual([]);
  expect(svg).toContain('width="960" height="540" viewBox="0 0 960 540"');
  expect(svg).toContain(`href="data:image/webp;base64,${frame(2).base64}"`);
  expect(svg).toContain('<use href="#frame-0"/>');
  expect(svg).toContain('animation:frame 7.5s step-end infinite');
  // Each frame shows for 1/3 of the loop, starting 2.5 s after the one before.
  expect(svg).toContain('33.33333333%,100%{opacity:0}');
  expect(svg).toContain('href="#frame-1" style="animation-delay:2.5s"');
  expect(svg).toContain('@media(prefers-reduced-motion:reduce){.motion{display:none}}');
  expect(svg).toContain(
    '<desc id="city-description">Rendered views of the interactive city &amp; its &lt;streets&gt;.</desc>',
  );
});

test('the check refuses what GitHub would not animate, or what is not a captured frame sequence', () => {
  const ok = coverSvg([frame(0), frame(1)], options);
  expect(checkCover(coverSvg([frame(0)], options)).join()).toMatch(/at least 2 frames/);
  expect(checkCover(ok.replace('</svg>', '<text>hi</text></svg>')).join()).toMatch(/text/);
  expect(checkCover(ok.replace('</svg>', '<script>1</script></svg>')).join()).toMatch(/script/);
  expect(checkCover(ok.replace('</svg>', '<foreignObject/></svg>')).join()).toMatch(/foreignObject/);
  expect(checkCover(ok.replace('step-end', 'linear')).join()).toMatch(/step-end/);
  expect(checkCover(ok.replace('<use href="#frame-0"/>', '')).join()).toMatch(/frame 0/);
  expect(checkCover(ok.replaceAll('image/webp', 'image/png')).join()).toMatch(/at least 2 frames/);
  expect(checkCover(ok + ' '.repeat(MAX_COVER_BYTES)).join()).toMatch(/MB/);
});
