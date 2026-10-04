import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { nextVersion, setVersion, ROOT } from '../scripts/version.mjs';
import { temporary } from './helpers.mjs';

async function fixture(t) {
  const root = await temporary(t);
  await mkdir(join(root, 'extension'));
  for (const file of ['package.json', 'extension/manifest.json', 'versions.md', 'version-state.json']) await cp(join(ROOT, file), join(root, file));
  // Keep fixtures independent of the real release log after users start it.
  for (const [name, version] of [['package.json', '0.0.0'], ['extension/manifest.json', '0.0.0.1']]) {
    const data = JSON.parse(await readFile(join(root, name), 'utf8')); data.version = version;
    await writeFile(join(root, name), JSON.stringify(data));
  }
  await writeFile(join(root, 'version-state.json'), JSON.stringify({ current: null, entries: [] }));
  await writeFile(join(root, 'versions.md'), '# Versions\n\nVersion logging has not started. No releases have been recorded.\n\n<!-- release-history -->\n\nNo releases yet.\n');
  return root;
}
test('decimal rollover includes 0.0.9 → 0.1.0 and 0.9.9 → 1.0.0', () => {
  assert.equal(nextVersion(null), '0.0.1');
  assert.equal(nextVersion('0.0.9'), '0.1.0');
  assert.equal(nextVersion('0.1.9'), '0.2.0');
  assert.equal(nextVersion('0.9.9'), '1.0.0');
  assert.equal(nextVersion('9.9.9'), '10.0.0');
  for (const bad of ['0.0.10', '0.10.0', '-1.0.0', '01.0.0']) assert.throws(() => nextVersion(bad));
});
test('next cannot start logging and start cannot run twice', async t => {
  const root = await fixture(t);
  await assert.rejects(setVersion(root, 'next', 'Not yet'), /has not started/);
  assert.equal(JSON.parse(await readFile(join(root, 'version-state.json'))).current, null);
  assert.equal(await setVersion(root, 'start', 'First test release', new Date('2026-10-04T12:00:00Z')), '0.0.1');
  await assert.rejects(setVersion(root, 'start', 'Duplicate'), /already started/);
  assert.equal(await setVersion(root, 'next', 'Second test release'), '0.0.2');
  for (const file of ['package.json', 'extension/manifest.json']) assert.equal(JSON.parse(await readFile(join(root, file))).version, '0.0.2');
  const log = await readFile(join(root, 'versions.md'), 'utf8');
  assert.match(log, /## 0.0.1/); assert.match(log, /## 0.0.2/);
});
test('inconsistent state fails before changing any manifest', async t => {
  const root = await fixture(t);
  const manifestBefore = await readFile(join(root, 'extension/manifest.json'), 'utf8');
  await writeFile(join(root, 'version-state.json'), JSON.stringify({ current: '0.1.0', entries: [] }));
  await assert.rejects(setVersion(root, 'next', 'Bad history'), /inconsistent/);
  assert.equal(await readFile(join(root, 'extension/manifest.json'), 'utf8'), manifestBefore);
});
test('version updates require a release message', async t => {
  const root = await fixture(t);
  await assert.rejects(setVersion(root, 'start', ''), /message/);
});
test('a stale staging file is preserved and manifests stay unchanged', async t => {
  const root = await fixture(t);
  const stale = join(root, 'package.json.version-tmp');
  await writeFile(stale, 'Existing recovery data');
  await assert.rejects(setVersion(root, 'start', 'Release'), /EEXIST/);
  assert.equal(await readFile(stale, 'utf8'), 'Existing recovery data');
  assert.equal(JSON.parse(await readFile(join(root, 'version-state.json'))).current, null);
});
