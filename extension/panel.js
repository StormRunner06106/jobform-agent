import { createDiagnostics, errorCode } from './diagnostics.js';
const diagnostics = createDiagnostics('panel');
diagnostics.log('panel.opened');
window.addEventListener('error', event => diagnostics.log('panel.script_error', { error: errorCode(event.message), errorType: event.error?.name }, 'error'));
window.addEventListener('unhandledrejection', event => diagnostics.log('panel.rejected', { error: errorCode(event.reason), errorType: event.reason?.name }, 'error'));
const $ = id => document.getElementById(id);
let filter = 'all', latest, shownSummary, accessOrigins = [];
async function send(type, extra = {}) {
  diagnostics.log('ui.request', { operation: type });
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error ?? 'Extension is unavailable. Reload it.');
  return response.result;
}
function render(state) {
  latest = state;
  $('status').textContent = state.message;
  $('agentBadge').textContent = state.connected ? 'Agent healthy' : state.connectionStatus === 'connecting' ? 'Agent connecting…' : state.connectionStatus === 'error' ? 'Connection failed' : 'Agent not connected yet';
  $('contextBadge').textContent = state.contextReady ? 'Context ready' : 'Context not loaded';
  $('agentBadge').classList.toggle('good', state.connected); $('contextBadge').classList.toggle('good', state.contextReady);
  $('run').disabled = state.running || !state.connected || !state.contextReady || !state.questions.length || !state.selectedRegion || Boolean(state.blockedFrames);
  $('stop').disabled = !state.running; $('load').disabled = state.running || state.connectionStatus === 'connecting'; $('scan').disabled = state.running || !state.connected;
  document.querySelectorAll('[data-stage]').forEach(el => { const stage = Number(el.dataset.stage); el.classList.toggle('done', stage < state.stage); el.classList.toggle('active', stage === state.stage); el.querySelector('.stageStatus').textContent = stage < state.stage ? 'Done' : stage === state.stage ? 'Active' : 'Waiting'; });
  $('region').hidden = $('regionLabel').hidden = state.regions.length < 2;
  $('region').replaceChildren(new Option('Choose application form', ''), ...state.regions.map(r => new Option(`${r.title} · frame ${r.frameId}`, r.id)));
  $('region').value = state.selectedRegion ?? '';
  const complete = state.questions.filter(q => q.state === 'complete').length;
  $('count').textContent = `${complete} / ${state.questions.length}`;
  $('progress').max = state.questions.length || 1; $('progress').value = complete;
  $('questions').replaceChildren();
  const questions = state.questions.filter(q => filter === 'all' || (filter === 'complete' ? q.state === 'complete' : q.state !== 'complete'));
  for (const q of questions) {
    const li = document.createElement('li'), mark = document.createElement('span'), body = document.createElement('div'), strong = document.createElement('strong'), small = document.createElement('small');
    mark.className = q.state === 'complete' ? 'mark' : 'mark attention'; mark.textContent = q.state === 'complete' ? '✓' : q.state === 'pending' ? '○' : '!';
    strong.textContent = q.label; small.textContent = q.uploadState || q.feedback || (q.state === 'complete' ? 'Complete · preserved' : `${q.required ? 'Required · ' : ''}${q.state}`);
    body.append(strong, small); li.append(mark, body); $('questions').append(li);
  }
  if (!questions.length) { const empty = document.createElement('li'); empty.className = 'empty'; empty.textContent = 'No questions in this view.'; $('questions').append(empty); }
  $('audit').replaceChildren(...state.audit.map(e => { const li = document.createElement('li'); li.textContent = `${e.time} · ${e.label} · ${e.status}${e.reason ? ' — ' + e.reason : ''}`; return li; }));
  if (state.summary && !state.running && state.summary !== shownSummary) { shownSummary = state.summary; $('finalTitle').textContent = state.message; $('finalMessage').textContent = state.summary; $('finalizer').showModal(); }
}
function action(id, handler) { $(id).addEventListener('click', () => { diagnostics.log('ui.click', { operation: id }); handler().catch(e => { diagnostics.log('ui.failed', { operation: id, error: errorCode(e), errorType: e.name }, 'error'); $('diagnostics').open = true; $('status').textContent = e.message; }); }); }
action('load', async () => { const settings = { contextRoot: $('contextRoot').value.trim() }; await chrome.storage.local.set({ settings }); render(await send('load', { settings })); });
action('access', async () => { if (!accessOrigins.length) throw new Error('Open an application page first.'); if (await chrome.permissions.request({ origins: accessOrigins })) $('status').textContent = 'Site access granted. Load or rescan the page.'; });
action('scan', async () => render(await send('scan')));
action('run', async () => { shownSummary = null; render(await send('run')); });
action('stop', async () => render(await send('stop')));
$('region').addEventListener('change', () => send('selectRegion', { id: $('region').value }).then(render).catch(e => { $('status').textContent = e.message; }));
$('closeFinal').addEventListener('click', () => $('finalizer').close());
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); if (latest) render(latest); }));
chrome.runtime.onMessage.addListener(message => { if (message.type === 'state') render(message.state); });
$('version').textContent = chrome.runtime.getManifest().version_name;
const saved = await chrome.storage.local.get('settings');
if (saved.settings) { $('contextRoot').value = saved.settings.contextRoot ?? ''; }
send('getState').then(render).catch(e => { $('status').textContent = e.message; });
async function refreshOrigins() { try { accessOrigins = await send('origins'); $('access').disabled = !accessOrigins.length; } catch { accessOrigins = []; $('access').disabled = true; } }
void refreshOrigins();
window.addEventListener('focus', refreshOrigins);
async function diagnosticRows() {
  const saved = await chrome.storage.local.get(['diagnostics-extension', 'diagnostics-panel']);
  return [...(saved['diagnostics-extension'] ?? []), ...(saved['diagnostics-panel'] ?? [])].sort((a, b) => a.time.localeCompare(b.time));
}
async function renderDiagnostics() {
  const rows = await diagnosticRows();
  $('diagnosticOutput').textContent = rows.slice(-80).map(row => `${row.time.slice(11, 23)} ${row.source} ${row.event}${row.operation ? ' ' + row.operation : ''}${row.error ? ' [' + row.error + ']' : ''}`).join('\n') || 'Waiting for events…';
  $('diagnosticOutput').scrollTop = $('diagnosticOutput').scrollHeight;
}
chrome.storage.onChanged.addListener(() => void renderDiagnostics().catch(() => {}));
void renderDiagnostics().catch(() => {});
action('exportLogs', async () => {
  const url = URL.createObjectURL(new Blob([(await diagnosticRows()).map(row => JSON.stringify(row)).join('\n')], { type: 'application/x-ndjson' }));
  const link = document.createElement('a'); link.href = url; link.download = 'jobform-diagnostics.jsonl'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
