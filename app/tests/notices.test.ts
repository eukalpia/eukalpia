import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNotices, runtimePackages } from '../scripts/notices.mjs';

const root = process.cwd();
const committed = readFileSync(join(root, 'public', 'THIRD-PARTY-NOTICES.txt'), 'utf8');

test('every package that ships in the bundle is listed, with the installed version and its license text', () => {
  const packages = runtimePackages(root);
  const names = packages.map(p => p.name);
  const declared = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies);
  for (const name of [...declared, 'scheduler']) expect(names).toContain(name);
  for (const p of packages) {
    const installed = JSON.parse(readFileSync(join(root, 'node_modules', p.name, 'package.json'), 'utf8'));
    expect(p.version, p.name).toBe(installed.version);
    expect(committed, p.name).toContain(`${p.name} ${p.version}\n${'='.repeat(60)}\n${p.text.trim()}`);
  }
});

test('the fonts (OFL) and the CC0 assets are credited, and the author is named as everywhere else', () => {
  expect(committed).toContain('@fontsource/ibm-plex-mono 5.3.0');
  expect(committed).toContain('@fontsource/barlow-condensed 5.3.0');
  expect(committed).toContain('SIL Open Font License, Version 1.1');
  expect(committed).toContain('CC0 ASSETS / POLY HAVEN');
  expect(committed).toContain("Umaraliev Ravshan Rustamjon O'gli");
  expect(committed).not.toMatch(/Ugli/);
});

test('the committed notices are what the script produces from the installed packages', () => {
  expect(committed).toBe(buildNotices(root));
});
