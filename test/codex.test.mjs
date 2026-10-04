import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { CodexClient } from '../companion/codex.mjs';
import { temporary } from './helpers.mjs';

function fakeProcess(status = 'completed') {
  const proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough(); proc.requests = [];
  const emit = obj => proc.stdout.write(JSON.stringify(obj) + '\n');
  proc.stdin = new Writable({ write(chunk, encoding, done) {
    const msg = JSON.parse(chunk.toString());
    proc.requests.push(msg);
    queueMicrotask(() => {
      if (msg.method === 'initialize') emit({ id: msg.id, result: {} });
      if (msg.method === 'thread/start' || msg.method === 'thread/resume') emit({ id: msg.id, result: { thread: { id: 'thread1' } } });
      if (msg.method === 'turn/start') {
        // Exercise notifications arriving before the request's response.
        emit({ method: 'item/completed', params: { threadId: 'thread1', turnId: 'turn1', item: { type: 'agentMessage', text: '{"healthy":true,"acknowledgement":"Hi"}' } } });
        emit({ method: 'turn/completed', params: { threadId: 'thread1', turn: { id: 'turn1', status } } });
        emit({ id: msg.id, result: { turn: { id: 'turn1' } } });
      }
    }); done();
  } });
  proc.kill = () => { proc.stdout.end(); proc.emit('exit', 0); };
  return proc;
}
test('Codex waits for successful completion and reuses the thread', async t => {
  const client = new CodexClient({ executable: process.execPath, home: await temporary(t), spawnProcess: () => fakeProcess() });
  t.after(() => client.close());
  assert.equal(await client.connect(), 'thread1');
  assert.equal((await client.turn('health', {})).healthy, true);
  assert.equal((await client.turn('again', {})).healthy, true);
  assert.equal(client.threadId, 'thread1');
});
test('a failed turn is not healthy even when its text claims success', async t => {
  const client = new CodexClient({ executable: process.execPath, home: await temporary(t), spawnProcess: () => fakeProcess('failed') });
  t.after(() => client.close()); await client.connect();
  await assert.rejects(client.turn('health', {}), /did not complete/);
});
test('a saved application thread resumes without starting a new thread', async t => {
  const proc = fakeProcess();
  const client = new CodexClient({ executable: process.execPath, home: await temporary(t), spawnProcess: () => proc });
  t.after(() => client.close()); await client.connect('thread1');
  assert.equal(proc.requests.some(r => r.method === 'thread/start'), false);
  assert.equal(proc.requests.find(r => r.method === 'thread/resume').params.threadId, 'thread1');
});
