// THIRD-PARTY-NOTICES.txt for the published site: the license of every npm package that ships in the
// bundle (the dependencies and theirs), then the fonts and CC0 assets from notices-assets.txt.
//
// Usage: node scripts/notices.mjs   (writes public/THIRD-PARTY-NOTICES.txt)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULE = '='.repeat(60);
const HEADER = `THIRD-PARTY SOFTWARE AND ASSET NOTICES

Original scene composition and implementation: Umaraliev Ravshan Rustamjon O'gli, 2026.
`;

const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

/** @param {string} root the app directory */
export function runtimePackages(root) {
  const found = new Map();
  const visit = name => {
    if (found.has(name)) return;
    const dir = join(root, 'node_modules', name);
    const pkg = readJson(join(dir, 'package.json'));
    const license = readdirSync(dir).find(f => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
    if (!license) throw new Error(`${name} has no license file`);
    found.set(name, { name, version: pkg.version, text: readFileSync(join(dir, license), 'utf8') });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
  };
  for (const name of Object.keys(readJson(join(root, 'package.json')).dependencies ?? {})) visit(name);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {string} root the app directory */
export function buildNotices(root) {
  const sections = runtimePackages(root).map(p => `${p.name} ${p.version}\n${RULE}\n${p.text.trim()}\n`);
  const assets = readFileSync(join(root, 'scripts', 'notices-assets.txt'), 'utf8').trim();
  return [HEADER, ...sections, `${assets}\n`].join('\n\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  if (!existsSync(join(root, 'node_modules'))) throw new Error('run npm ci first');
  writeFileSync(join(root, 'public', 'THIRD-PARTY-NOTICES.txt'), buildNotices(root));
  console.log('public/THIRD-PARTY-NOTICES.txt written');
}
