import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

export async function browser(t) {
  const executable = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  try { await access(executable); } catch { t.skip('Set CHROME_PATH to run browser integration tests.'); return null; }
  const root = await mkdtemp(join(tmpdir(), 'jobform-test-'));
  const proc = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--allow-file-access-from-files', '--remote-debugging-port=0', `--user-data-dir=${join(root, 'chrome')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { proc.kill(); reject(new Error('Chrome startup timed out.')); }, 20000);
    proc.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timer); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); };
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP ${method} timeout`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  t.after(async () => {
    await send('Browser.close').catch(() => {});
    socket.close();
    if (proc.exitCode === null) await new Promise(resolve => { proc.once('exit', resolve); setTimeout(() => { proc.kill(); resolve(); }, 2000).unref(); });
    const rel = relative(resolve(tmpdir()), resolve(root));
    if (isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('jobform-test-')) throw new Error('Unsafe browser cleanup path.');
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable'); await call('Runtime.enable');
  return {
    call,
    async evaluate(expression) {
      const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
      return response.result.value;
    },
    async html(html) { const tree = await call('Page.getFrameTree'); await call('Page.setDocumentContent', { frameId: tree.frameTree.frame.id, html }); },
  };
}
