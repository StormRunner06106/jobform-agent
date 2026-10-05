import { join } from 'node:path';
import { homedir } from 'node:os';
import { readFile, writeFile } from 'node:fs/promises';
import { CodexClient } from './codex.mjs';
import { resolveCodex } from './resolve-codex.mjs';
import { MessageDecoder, encodeMessage } from './framing.mjs';
import { loadContext, verifyContext, retrieve } from './context.mjs';
import { healthSchema, answerSchema, validateAnswer, filterQuestions, INFERENCE_POLICY } from './contract.mjs';
import { log } from './logging.mjs';
import { errorCode } from '../extension/diagnostics.js';

const origin = process.argv[2];
log('host.started');
if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin ?? '')) { log('host.invalid_origin', {}, 'error'); process.exit(1); }
const home = join(process.env.LOCALAPPDATA ?? homedir(), 'jobform-agent', 'codex');
const clientVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const write = value => process.stdout.write(encodeMessage(value));
let client, context, busy = false, generation = 0, lastHealth = 0, application, lastOperation = Date.now();
const sessionPath = join(home, `${origin.split('/')[2]}.session.json`);
setInterval(() => { if (!busy && Date.now() - lastOperation > 8 * 60 * 60 * 1000) { client?.close(); process.exit(0); } }, 60000).unref();
const decoder = new MessageDecoder();
async function checkHealth() {
  log('health.started');
  const answer = await client.turn('hi, are you healthy now?', healthSchema);
  if (answer?.healthy !== true || typeof answer.acknowledgement !== 'string' || !answer.acknowledgement.trim()) throw new Error('Agent health check failed.');
  lastHealth = Date.now();
  log('health.completed', { code: 200 });
}
async function handle(message) {
  const { id, type, payload = {} } = message;
  if (typeof id !== 'string') return;
  const started = Date.now();
  log('request.received', { requestId: id, operation: type });
  if (type === 'cancel') { generation++; client?.interrupt(); write({ id, ok: true, result: { stopped: true } }); return; }
  if (type === 'ping') { write({ id, ok: true, result: { connected: Boolean(client?.threadId), healthyAt: lastHealth } }); return; }
  if (busy) { write({ id, ok: false, error: 'Companion is busy.' }); return; }
  lastOperation = Date.now();
  busy = true;
  const currentGeneration = generation;
  try {
    let result;
    if (type === 'load') {
      client?.close(); context = null; lastHealth = 0;
      write({ event: 'progress', stage: 1, message: 'Reading local knowledge' });
      context = await loadContext(payload.contextRoot);
      log('context.loaded', { requestId: id, documents: context.documents.length });
      const executable = await resolveCodex();
      log('codex.resolved', { requestId: id });
      client = new CodexClient({ executable, home, clientVersion, onProgress: () => {}, onDiagnostic: log });
      let saved;
      try { saved = JSON.parse(await readFile(sessionPath, 'utf8')); } catch { /* First connection. */ }
      const resume = saved?.fingerprint === context.fingerprint && saved?.application === payload.application && saved?.root === context.root ? saved.threadId : null;
      await client.connect(resume);
      log('codex.connected', { requestId: id, phase: resume ? 'resumed' : 'created' });
      await checkHealth();
      application = payload.application;
      await writeFile(sessionPath, JSON.stringify({ root: context.root, fingerprint: context.fingerprint, application, threadId: client.threadId }));
      result = { code: 200, status: 'good', threadId: client.threadId, contextRoot: context.root, documents: context.documents.length, skipped: context.skipped, fingerprint: context.fingerprint };
    } else if (type === 'generate') {
      if (!client?.threadId || !context) throw new Error('Click Load to connect Codex and load knowledge first.');
      if (payload.application !== application) throw new Error('The application changed. Click Load for a new session.');
      await verifyContext(context);
      if (Date.now() - lastHealth > 300000) await checkHealth();
      const request = { runId: payload.runId, snapshotId: payload.snapshotId, questions: filterQuestions(payload.questions) };
      if (!request.questions.length) throw new Error('No pending questions.');
      const evidence = retrieve(context, request.questions);
      const prompt = JSON.stringify({ task: 'Fill only pending_questions using direct evidence or the best-supported inference from related evidence.', inference_policy: INFERENCE_POLICY, runId: request.runId, snapshotId: request.snapshotId, pending_questions: request.questions, evidence, job: String(payload.job ?? '').slice(0, 3000) });
      result = validateAnswer(await client.turn(prompt, answerSchema), request, evidence);
    } else throw new Error('Unknown companion operation.');
    if (generation !== currentGeneration) throw new Error('Operation cancelled.');
    write({ id, ok: true, result });
    log('request.completed', { requestId: id, operation: type, elapsedMs: Date.now() - started });
  } catch (error) {
    log('request.failed', { requestId: id, operation: type, error: errorCode(error), errorType: error.name, elapsedMs: Date.now() - started }, 'error');
    lastHealth = 0;
    if (type === 'load') { client?.close(); context = null; }
    write({ id, ok: false, error: String(error.message).slice(0, 700) });
  } finally { busy = false; }
}
process.stdin.on('data', chunk => { try { for (const message of decoder.push(chunk)) void handle(message); } catch { log('host.invalid_frame', {}, 'error'); client?.close(); process.exit(1); } });
process.stdin.on('end', () => { log('host.stdin_closed'); client?.close(); process.exit(0); });
process.on('uncaughtException', error => { log('host.crashed', { error: errorCode(error), errorType: error.name }, 'error'); client?.close(); process.exit(1); });
process.on('SIGTERM', () => { client?.close(); process.exit(0); });
