import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './version.mjs';
async function check(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'dist'].includes(e.name)) continue;
    const path = resolve(dir, e.name);
    if (e.isDirectory()) await check(path);
    else if (/\.(mjs|js)$/.test(e.name)) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    } else if (e.name.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
  }
}
await check(ROOT);
console.log('JavaScript syntax and JSON checks passed.');
