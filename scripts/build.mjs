import { cp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from './version.mjs';

const state = JSON.parse(await readFile(resolve(ROOT, 'version-state.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(ROOT, 'extension/manifest.json'), 'utf8'));
if (manifest.version !== (state.current ?? '0.0.0.1')) throw new Error('Manifest and version history disagree.');
await mkdir(resolve(ROOT, 'dist/extension'), { recursive: true });
await cp(resolve(ROOT, 'extension'), resolve(ROOT, 'dist/extension'), { recursive: true });
console.log(`Built dist/extension (${state.current ?? 'unreleased development build'}). Version log unchanged.`);
