import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { temporary } from './helpers.mjs';

test('installer discovers the matching Chrome ID, reuses registration, and rejects ambiguity', { skip: process.platform !== 'win32' }, async t => {
  const root = await temporary(t);
  const chrome = join(root, 'Chrome');
  const profile = join(chrome, 'Profile 3');
  const extension = join(root, 'checkout', 'dist', 'extension');
  const manifest = join(root, 'host.json');
  const runner = join(root, 'resolve.ps1');
  const id = 'a'.repeat(32), otherId = 'b'.repeat(32);
  await mkdir(profile, { recursive: true });
  await writeFile(runner, `param($Helper, $Extension, $Chrome, $Manifest)
$ErrorActionPreference = 'Stop'
. $Helper
Get-JobFormExtensionId -ExtensionPath $Extension -ChromeUserData $Chrome -SavedManifest $Manifest
`);
  const run = () => spawnSync(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner,
    '-Helper', resolve('scripts/resolve-extension-id.ps1'), '-Extension', extension,
    '-Chrome', chrome, '-Manifest', manifest,
  ], { encoding: 'utf8', windowsHide: true });
  const preferences = settings => writeFile(join(profile, 'Secure Preferences'), JSON.stringify({ extensions: { settings } }));

  await preferences({ [id]: { path: extension }, [otherId]: { path: join(root, 'unrelated'), manifest: { name: 'Job Form Agent' } } });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), id);

  await writeFile(manifest, JSON.stringify({ name: 'com.jobform.agent', allowed_origins: [`chrome-extension://${otherId}/`] }));
  result = run();
  assert.equal(result.stdout.trim(), id, 'current installation takes precedence over stale registration');
  await preferences({});
  result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), otherId);

  await preferences({ [id]: { path: extension }, [otherId]: { path: extension } });
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Multiple extension IDs/);

  await preferences({});
  await writeFile(manifest, JSON.stringify({ name: 'com.jobform.agent', allowed_origins: ['chrome-extension://*/'] }));
  result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Load dist\/extension in Chrome first/);
});
