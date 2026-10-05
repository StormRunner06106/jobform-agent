import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('connection states distinguish idle, failed health, and connected with a page error', async () => {
  let listener, hostListener, answer = { ok: false, error: 'Please sign in to Codex.' };
  const updates = [];
  const chrome = {
    runtime: {
      id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: async message => { updates.push(structuredClone(message.state)); },
      connectNative: () => ({
        onMessage: { addListener: callback => { hostListener = callback; } },
        onDisconnect: { addListener() {} },
        postMessage: message => queueMicrotask(() => hostListener({ id: message.id, ...answer })),
      }),
    },
    action: { onClicked: { addListener() {} } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.test/apply' }],
      get: async () => { throw new Error('Application tab closed.'); },
    },
  };
  runInNewContext(await readFile(new URL('../extension/background.js', import.meta.url), 'utf8'), { chrome, URL, setTimeout, clearTimeout });
  const send = type => new Promise(resolve => listener({ type, settings: { contextRoot: 'C:/Knowledge' } }, { id: chrome.runtime.id, url: chrome.runtime.getURL('panel.html') }, resolve));
  assert.equal((await send('getState')).result.connectionStatus, 'idle');
  const failure = await send('load');
  assert.equal(failure.ok, false);
  assert.match(failure.error, /Connection failed: Please sign in to Codex/);
  assert.ok(updates.some(state => state.connectionStatus === 'connecting'));
  assert.equal((await send('getState')).result.connectionStatus, 'error');
  assert.equal((await send('getState')).result.connected, false);

  answer = { ok: true, result: { code: 200, documents: 5 } };
  const pageFailure = await send('load');
  assert.equal(pageFailure.error, 'Application tab closed.');
  const connected = (await send('getState')).result;
  assert.equal(connected.connectionStatus, 'connected');
  assert.equal(connected.connected, true);
  assert.equal(connected.contextReady, true);
});
