export function errorCode(error) {
  const message = String(error?.message ?? error ?? '');
  const rules = [
    [/specified native messaging host not found|native messaging host.*not found/i, 'native_host_not_found'],
    [/access.*native messaging host.*forbidden/i, 'native_origin_forbidden'],
    [/failed to start native messaging host/i, 'native_launch_failed'],
    [/native host has exited|companion disconnected/i, 'native_host_exited'],
    [/communicating with.*native|native message|protocol output/i, 'native_protocol_error'],
    [/receiving end does not exist|could not establish connection/i, 'extension_worker_unavailable'],
    [/extension context invalidated/i, 'extension_reloaded'],
    [/timed out|timeout/i, 'timeout'],
    [/sign in|login|auth|401/i, 'authentication_failed'],
    [/model.*not supported|model access/i, 'model_unavailable'],
    [/ENOENT|no such file/i, 'file_not_found'],
    [/absolute.*path|knowledge path/i, 'invalid_context_path'],
    [/No usable Markdown/i, 'no_knowledge_files'],
    [/too large|exceeds 200/i, 'context_limit'],
    [/Codex was not found/i, 'codex_not_found'],
    [/HTTP or HTTPS/i, 'not_a_job_page'],
    [/cannot access|permission|inaccessible/i, 'page_access_denied'],
    [/form did not settle/i, 'form_not_ready'],
    [/busy|already running/i, 'busy'],
    [/page changed|tab closed|no tab/i, 'page_changed'],
    [/health check/i, 'health_failed'],
  ];
  return rules.find(([pattern]) => pattern.test(message))?.[1] ?? 'unclassified_error';
}

// Only operational metadata is accepted. No raw errors, paths, URLs, prompts or values.
export function safeRecord(input) {
  const output = {};
  for (const key of ['id', 'source', 'event', 'level', 'requestId', 'operation', 'phase', 'error', 'errorType', 'extensionId']) {
    if (typeof input[key] === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(input[key])) output[key] = input[key];
  }
  output.time = Number.isFinite(Date.parse(input.time)) ? new Date(input.time).toISOString() : new Date().toISOString();
  for (const key of ['elapsedMs', 'frameId', 'frames', 'blockedFrames', 'regions', 'questions', 'documents', 'code', 'pid']) {
    if (Number.isFinite(input[key])) output[key] = input[key];
  }
  return output;
}

export function createDiagnostics(source, storage = chrome.storage.local, transport = fetch) {
  const key = `diagnostics-${source}`;
  let rows = [], queue = storage.get(key).then(saved => { rows = (saved[key] ?? []).slice(-300).map(safeRecord); }).catch(() => {});
  let sending = false, timer;
  async function stream() {
    if (sending || !rows.length) return;
    sending = true;
    try {
      await transport('http://127.0.0.1:43189/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows), signal: AbortSignal.timeout(1500) });
    } catch { /* Local storage remains available when the watcher is stopped. */ }
    finally { sending = false; }
  }
  function log(event, details = {}, level = 'info') {
    const row = safeRecord({ ...details, id: crypto.randomUUID(), time: new Date().toISOString(), source, event, level });
    queue = queue.then(async () => {
      rows = [...rows, row].slice(-300);
      await storage.set({ [key]: rows });
    }).catch(() => {}).then(() => { clearTimeout(timer); timer = setTimeout(() => void stream(), 100); });
  }
  return { log, async entries() { await queue; return rows; } };
}
