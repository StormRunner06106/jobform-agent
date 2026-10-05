import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDiagnostics, errorCode, safeRecord } from '../extension/diagnostics.js';
import { appendDiagnostic } from '../companion/logging.mjs';
import { createLogReceiver } from '../scripts/watch-logs.mjs';
import { temporary } from './helpers.mjs';

test('diagnostics retain operational errors without raw errors, paths, answers or credentials', () => {
  const row = safeRecord({ id: 'event-1', source: 'extension', event: 'native.disconnected', error: errorCode('Specified native messaging host not found.'), path: 'C:/Private/profile.txt', answer: 'private answer', token: 'secret', message: 'raw error', elapsedMs: 20 });
  assert.equal(row.error, 'native_host_not_found');
  assert.equal(row.elapsedMs, 20);
  assert.doesNotMatch(JSON.stringify(row), /Private|private answer|secret|raw error/);
});

test('extension logs survive restart, stay bounded and tolerate an unavailable receiver', async () => {
  const data = {};
  const storage = { get: async key => ({ [key]: data[key] }), set: async value => Object.assign(data, value) };
  const unavailable = async () => { throw new Error('offline'); };
  const log = createDiagnostics('extension', storage, unavailable);
  for (let i = 0; i < 310; i++) log.log('native.request', { requestId: String(i) });
  assert.equal((await log.entries()).length, 300);
  const restarted = createDiagnostics('extension', storage, unavailable);
  assert.equal((await restarted.entries())[0].requestId, '10');
  await new Promise(resolve => setTimeout(resolve, 150));
});

test('live receiver accepts registered origins, deduplicates and strips private data', async t => {
  const directory = await temporary(t), origin = 'chrome-extension://' + 'a'.repeat(32);
  const received = [];
  const server = createLogReceiver({ origins: [origin], directory, onRecord: row => received.push(row) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/events`;
  const batch = [{ id: 'event-1', source: 'panel', event: 'ui.click', operation: 'load', answer: 'do not persist' }];
  const post = from => fetch(url, { method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify(batch) });
  assert.equal((await post('https://untrusted.test')).status, 403);
  assert.equal((await post(origin)).status, 204);
  assert.equal((await post(origin)).status, 204);
  assert.equal(received.length, 1);
  const stored = await readFile(join(directory, 'extension.jsonl'), 'utf8');
  assert.match(stored, /ui.click/);
  assert.doesNotMatch(stored, /do not persist/);
  const oversized = await fetch(url, { method: 'POST', headers: { Origin: origin }, body: 'x'.repeat(256001) });
  assert.equal(oversized.status, 413);
});

test('companion logs rotate outside native messaging stdout', async t => {
  const directory = await temporary(t), file = join(directory, 'companion.jsonl');
  await writeFile(file, 'x'.repeat(1_000_001));
  appendDiagnostic('companion.jsonl', { event: 'health.started' }, directory);
  assert.equal((await readFile(file + '.1', 'utf8')).length, 1_000_001);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).event, 'health.started');
});
