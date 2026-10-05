import { createDiagnostics, errorCode } from './diagnostics.js';
const diagnostics = createDiagnostics('extension');
const HOST = 'com.jobform.agent';
diagnostics.log('worker.started', { extensionId: chrome.runtime.id });
let native, boundTab, busy = false, epoch = 0, selectedRegion, application;
let snapshots = [], sequence = 0;
const pending = new Map();
const state = { connected: false, connectionStatus: 'idle', contextReady: false, running: false, stage: 0, message: 'Open a job page, select your knowledge folder, and click Load knowledge to connect.', questions: [], regions: [], audit: [], blockedFrames: 0, summary: null };
const broadcast = () => chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});
function update(patch) { Object.assign(state, patch); broadcast(); }
function audit(label, status, reason = '') {
  diagnostics.log('fill.outcome', { phase: status });
  state.audit.push({ time: new Date().toLocaleTimeString(), label, status, reason });
  state.audit = state.audit.slice(-200); broadcast();
}
function connectNative() {
  if (native) return;
  diagnostics.log('native.connect');
  native = chrome.runtime.connectNative(HOST);
  native.onMessage.addListener(message => {
    diagnostics.log('native.message', { requestId: message.id, phase: message.event, code: message.result?.code, error: message.ok === false ? errorCode(message.error) : undefined }, message.ok === false ? 'error' : 'info');
    if (message.event === 'progress') { update({ stage: message.stage, message: message.message }); return; }
    const call = pending.get(message.id); if (!call) return;
    clearTimeout(call.timer); pending.delete(message.id);
    if (message.ok) call.resolve(message.result); else call.reject(new Error(message.error));
  });
  native.onDisconnect.addListener(() => {
    const reason = chrome.runtime.lastError?.message ?? 'Companion disconnected.';
    diagnostics.log('native.disconnected', { error: errorCode(reason) }, 'error');
    native = null; epoch++;
    for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error(reason)); }
    pending.clear(); update({ connected: false, connectionStatus: 'error', contextReady: false, running: false, message: `${reason} Click Load knowledge to reconnect.` });
  });
}
function callHost(type, payload = {}) {
  connectNative();
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    diagnostics.log('native.request', { requestId: id, operation: type });
    const timer = setTimeout(() => { diagnostics.log('native.timeout', { requestId: id, operation: type }, 'error'); pending.delete(id); reject(new Error('Companion request timed out.')); }, 120000);
    pending.set(id, { resolve, reject, timer });
    try { native.postMessage({ id, type, payload }); }
    catch (error) { clearTimeout(timer); pending.delete(id); diagnostics.log('native.send_failed', { requestId: id, error: errorCode(error) }, 'error'); reject(error); }
  });
}
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  diagnostics.log('page.active', { phase: /^https?:/.test(tab?.url ?? '') ? 'http' : 'unavailable' });
  if (!tab || !/^https?:/.test(tab.url ?? '')) throw new Error('Open a job application on an HTTP or HTTPS page.');
  return tab;
}
function getApplication(url) { const u = new URL(url); return u.origin + u.pathname; }
async function pageCall(frameId, method, argument) {
  const results = await chrome.scripting.executeScript({ target: { tabId: boundTab, frameIds: [frameId] }, func: async (method, argument) => {
    if (!globalThis.jobformScanner) throw new Error('Page scanner is missing.');
    return await globalThis.jobformScanner[method](argument);
  }, args: [method, argument] });
  if (!results[0]?.result) throw new Error('Page changed or became inaccessible.');
  const value = results[0].result;
  return Array.isArray(value) ? { outcomes: value } : { ...value, frameId, documentId: results[0].documentId };
}
async function scan() {
  diagnostics.log('scan.started');
  const tab = await chrome.tabs.get(boundTab);
  if (getApplication(tab.url) !== application) throw new Error('Page changed. Click Load for this application.');
  const frames = await chrome.webNavigation.getAllFrames({ tabId: boundTab });
  snapshots = []; let blocked = 0;
  for (const frame of frames ?? []) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: boundTab, frameIds: [frame.frameId] }, files: ['scanner.js'] });
      const snapshot = await pageCall(frame.frameId, 'scan', selectedRegion);
      diagnostics.log('scan.frame_completed', { frameId: frame.frameId, regions: snapshot.regions.length, questions: snapshot.questions.length });
      snapshots.push(snapshot);
    } catch (error) { blocked++; diagnostics.log('scan.frame_failed', { frameId: frame.frameId, error: errorCode(error) }, 'error'); }
  }
  const regions = snapshots.flatMap(s => s.regions.map(r => ({ ...r, frameId: s.frameId })));
  if (!selectedRegion && regions.length === 1) selectedRegion = regions[0].id;
  const relevant = snapshots.filter(s => s.regionId === selectedRegion);
  const questions = relevant.flatMap(s => s.questions.map(q => ({ ...q, frameId: s.frameId, documentId: s.documentId })));
  diagnostics.log('scan.completed', { frames: snapshots.length, blockedFrames: blocked, regions: regions.length, questions: questions.length });
  update({ stage: 2, regions, questions, blockedFrames: blocked, selectedRegion, message: !regions.length ? 'No form found. Check site access or wait for the page to load.' : regions.length > 1 && !selectedRegion ? 'Choose the application form below.' : `${questions.filter(q => q.state === 'complete').length} of ${questions.length} questions already complete.` });
  return relevant;
}
async function stableScan() {
  const started = Date.now(); let previous;
  while (Date.now() - started < 20000) {
    const snapshots = await scan();
    if (state.regions.length > 1 && !selectedRegion) return snapshots;
    const current = JSON.stringify(snapshots.map(s => s.questions.map(q => [q.id, q.state, q.currentValue, q.feedback])));
    if (current === previous && state.questions.length) return snapshots;
    previous = current; await new Promise(resolve => setTimeout(resolve, 750));
  }
  throw new Error('Form did not settle. Try scanning again after the page loads.');
}
async function run() {
  if (!state.connected || !state.contextReady) throw new Error('Load Codex and knowledge first.');
  if (!selectedRegion) throw new Error('Select an application form.');
  const runEpoch = ++epoch, runId = crypto.randomUUID(), started = Date.now(), needsUser = new Set();
  const guard = () => { if (epoch !== runEpoch) throw new Error('Stopped.'); if (Date.now() - started > 300000) throw new Error('Run limit reached. Review unresolved questions.'); };
  update({ running: true, summary: null });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await stableScan(); guard();
      if (state.blockedFrames) throw new Error('Some frames are inaccessible. Grant site access before running.');
      const questions = state.questions.filter(q => q.state === 'pending' && !needsUser.has(q.id));
      if (!questions.length) break;
      const snapshotId = crypto.randomUUID();
      update({ stage: 3, message: `Preparing answers · pass ${attempt + 1} of 3` });
      // Build outbound records explicitly: never include existing values, locators, or filled records.
      const outbound = questions.map(q => {
        const output = {};
        for (const key of ['id', 'kind', 'label', 'placeholder', 'help', 'required', 'minLength', 'maxLength', 'min', 'max', 'pattern', 'options', 'feedback']) output[key] = q[key];
        return output;
      });
      const response = await callHost('generate', { runId, snapshotId, application, questions: outbound, job: snapshots.find(s => s.regionId === selectedRegion)?.title ?? '' });
      guard();
      if (response.runId !== runId || response.snapshotId !== snapshotId) throw new Error('Stale agent response.');
      const eligible = new Map(questions.map(q => [q.id, q]));
      for (const result of response.results) {
        guard();
        const q = eligible.get(result.id); if (!q) throw new Error('Agent returned an unknown question.');
        if (result.disposition !== 'fill') { needsUser.add(q.id); audit(q.label, 'needs-user', result.reason); continue; }
        const frameNow = await chrome.webNavigation.getFrame({ tabId: boundTab, frameId: q.frameId });
        if (frameNow?.documentId !== q.documentId) throw new Error('Application frame changed. Scan again.');
        update({ message: `Filling ${q.label}` });
        const outcome = await pageCall(q.frameId, 'apply', [result]);
        for (const row of outcome.outcomes) audit(q.label, row.state, row.reason);
      }
      update({ stage: 4, message: 'Checking the form after filling' });
    }
    await stableScan(); guard();
    const blockers = state.questions.filter(q => q.state !== 'complete');
    if (blockers.length || state.blockedFrames) {
      update({ stage: 4, message: 'Needs attention', summary: `${blockers.length} questions need review. Uploads, consent and unsupported controls remain manual.` });
    } else {
      const snapshot = snapshots.find(s => s.regionId === selectedRegion);
      if (!snapshot || !state.questions.length) throw new Error('No verified form to finalize.');
      const result = await pageCall(snapshot.frameId, 'finish', selectedRegion);
      update({ stage: 4, message: result.target === 'next' ? 'Current step complete' : 'Form complete — review before submitting', summary: result.target === 'unknown' ? 'All detected questions are complete. Review and locate Submit on the page.' : 'Review your answers. The extension has not submitted the application.' });
    }
  } finally { update({ running: false }); }
}
chrome.action.onClicked.addListener(async tab => { boundTab = tab.id; await chrome.sidePanel.open({ tabId: tab.id }); });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only the extension's own panel may start privileged operations.
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('panel.html')) return;
  const operationStarted = Date.now();
  diagnostics.log('panel.request', { operation: message.type });
  (async () => {
    if (message.type === 'getState') return state;
    if (message.type === 'origins') {
      const tab = await activeTab();
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      return [...new Set([tab.url, ...(frames ?? []).map(f => f.url)].filter(u => /^https?:/.test(u)).map(u => new URL(u).origin + '/*'))];
    }
    if (message.type === 'stop') { epoch++; await callHost('cancel').catch(() => {}); update({ running: false, message: 'Stopped. Existing answers are preserved.' }); return state; }
    if (busy) throw new Error('An operation is already running.');
    busy = true;
    try {
      if (message.type === 'load') {
        const tab = await activeTab(); boundTab = tab.id; application = getApplication(tab.url); selectedRegion = null;
        update({ connected: false, connectionStatus: 'connecting', contextReady: false, stage: 1, message: 'Connecting to Codex', summary: null });
        let result;
        try {
          result = await callHost('load', { ...message.settings, application });
          if (result.code !== 200) throw new Error('Health check failed.');
        } catch (error) {
          update({ connectionStatus: 'error' });
          throw new Error(`Connection failed: ${error.message} Click Load knowledge to retry.`);
        }
        update({ connected: true, connectionStatus: 'connected', contextReady: true, message: `Connected · ${result.documents} knowledge files`, context: result });
        await stableScan();
      } else if (message.type === 'scan') { await scan(); }
      else if (message.type === 'selectRegion') { selectedRegion = message.id; await scan(); }
      else if (message.type === 'run') await run();
      else throw new Error('Unknown operation.');
      return state;
    } finally { busy = false; }
  })().then(result => { diagnostics.log('panel.completed', { operation: message.type, elapsedMs: Date.now() - operationStarted }); respond({ ok: true, result }); }).catch(error => { diagnostics.log('panel.failed', { operation: message.type, error: errorCode(error), errorType: error.name, elapsedMs: Date.now() - operationStarted }, 'error'); update({ message: error.message }); respond({ ok: false, error: error.message }); });
  return true;
});
