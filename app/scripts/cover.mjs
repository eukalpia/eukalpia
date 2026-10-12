// The README cover: captured frames of the city in an SVG that GitHub animates with CSS alone.
// checkCover holds the rules CI enforces before publishing.

/** GitHub serves README images through a proxy; v1's cover was 3.56 MB. */
export const MAX_COVER_BYTES = 4 * 1024 * 1024;

const escapeXml = text =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decimal = n => String(Number(n.toFixed(8)));

/**
 * @param {{ mime: string, base64: string }[]} frames
 * @param {{ width: number, height: number, seconds: number, title: string, description: string }} o
 * @returns {string}
 */
export function coverSvg(frames, o) {
  const { width: w, height: h } = o;
  const images = frames
    .map((f, i) => `<image id="frame-${i}" width="${w}" height="${h}" href="data:${f.mime};base64,${f.base64}"/>`)
    .join('');
  const share = decimal(100 / frames.length);
  const step = o.seconds / frames.length;
  const uses = frames
    .map((_, i) => `<use class="frame" opacity="0" href="#frame-${i}" style="animation-delay:${decimal(i * step)}s"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" ` +
    `aria-labelledby="city-title city-description"><title id="city-title">${escapeXml(o.title)}</title>` +
    `<desc id="city-description">${escapeXml(o.description)}</desc><defs>${images}</defs>` +
    `<style>.frame{opacity:0;animation:frame ${decimal(o.seconds)}s step-end infinite}` +
    `@keyframes frame{0%{opacity:1}${share}%,100%{opacity:0}}` +
    `@media(prefers-reduced-motion:reduce){.motion{display:none}}</style>` +
    `<use href="#frame-0"/><g class="motion">${uses}</g></svg>`
  );
}

/**
 * Why this SVG cannot be the README cover; empty when it can.
 * @param {string} svg
 * @returns {string[]}
 */
export function checkCover(svg) {
  const problems = [];
  const frames = [...svg.matchAll(/<image\b[^>]*\bhref="data:image\/(?:jpeg|webp);base64,[^"]+"/g)].length;
  if (frames < 2) problems.push(`needs at least 2 frames of base64 JPEG or WebP, has ${frames}`);
  for (const tag of ['text', 'foreignObject', 'script'])
    if (new RegExp(`<${tag}\\b`, 'i').test(svg)) problems.push(`must not contain <${tag}>`);
  if (!/animation:[^;}]*step-end/.test(svg)) problems.push('frames must switch with a step-end animation');
  if (!/<use href="#frame-0"\s*\/>/.test(svg)) problems.push('frame 0 must be shown when the animation does not run');
  const bytes = Buffer.byteLength(svg);
  if (bytes > MAX_COVER_BYTES) problems.push(`is ${(bytes / 1048576).toFixed(2)} MB, more than 4 MB`);
  return problems;
}
