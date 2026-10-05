import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { temporary } from './helpers.mjs';
import { resolveCodex } from '../companion/resolve-codex.mjs';

async function install(directory) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'codex.exe');
  await writeFile(file, 'synthetic executable fixture');
  return realpath(file);
}

test('Codex discovery skips relative PATH entries and resolves a native executable', async t => {
  const root = await temporary(t);
  const directory = join(root, 'CLI with spaces');
  const expected = await install(directory);
  assert.equal(await resolveCodex({ env: { Path: ['', '.', 'relative', `"${directory}"`].join(delimiter) }, userHome: root, platform: 'win32', arch: 'x64' }), expected);
});

test('Codex discovery falls back to newest complete VS Code installation with stale PATH', async t => {
  const root = await temporary(t);
  const extensions = join(root, '.vscode', 'extensions');
  await install(join(root, 'old-cli'));
  await install(join(extensions, 'openai.chatgpt-1.9.0-win32-x64', 'bin', 'windows-x86_64'));
  const expected = await install(join(extensions, 'openai.chatgpt-1.10.0-win32-x64', 'bin', 'windows-x86_64'));
  await mkdir(join(extensions, 'openai.chatgpt-1.11.0-win32-x64'));
  assert.equal(await resolveCodex({ env: { PATH: [join(root, 'removed'), join(root, 'old-cli')].join(delimiter) }, userHome: root, platform: 'win32', arch: 'x64' }), expected);
});

test('missing Codex gives actionable setup instructions', async t => {
  const root = await temporary(t);
  await assert.rejects(resolveCodex({ env: {}, userHome: root, platform: 'win32', arch: 'x64' }), /Codex was not found.*restart Chrome/);
});
