// What CI checks before publishing app/dist: no source maps, the files the page and social previews
// need, and a README cover GitHub will animate.
//
// Usage: node scripts/check-release.mjs <dist> <profile-cover.svg>
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCover } from './cover.mjs';

export const REQUIRED_FILES = ['index.html', 'favicon.svg', 'og.png', 'city-cinematic.webp', 'THIRD-PARTY-NOTICES.txt'];

const filesIn = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)],
  );

/**
 * Why this build cannot be published; empty when it can.
 * @param {string} dist
 * @param {string} coverFile
 * @returns {string[]}
 */
export function checkRelease(dist, coverFile) {
  const problems = [];
  const files = filesIn(dist).map(f => relative(dist, f).split('\\').join('/'));
  for (const f of files) if (f.endsWith('.map')) problems.push(`source map in the build: ${f}`);
  for (const f of REQUIRED_FILES) if (!files.includes(f)) problems.push(`missing from the build: ${f}`);
  if (!existsSync(coverFile)) problems.push(`no README cover at ${coverFile}`);
  else for (const p of checkCover(readFileSync(coverFile, 'utf8'))) problems.push(`README cover ${p}`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dist, cover] = process.argv.slice(2);
  const problems = checkRelease(dist, cover);
  if (problems.length) {
    console.error(`The release is not ready:\n${problems.map(p => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Release checked: ${dist} and ${cover}.`);
}
