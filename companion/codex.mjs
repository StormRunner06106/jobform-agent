import { spawn } from 'node:child_process';
import { mkdir, access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isAbsolute, join } from 'node:path';
import { INSTRUCTIONS } from './contract.mjs';
import { errorCode } from '../extension/diagnostics.js';

export class CodexClient {
  constructor({ executable, home, clientVersion = '0.0.0', onProgress = () => {}, onDiagnostic = () => {}, spawnProcess = spawn }) {
    this.log = onDiagnostic;
    this.executable = executable; this.home = home; this.onProgress = onProgress; this.spawnProcess = spawnProcess;
    this.sequence = 0; this.pending = new Map(); this.active = null; this.threadId = null; this.clientVersion = clientVersion;
  }
  async connect(resumeId = null) {
    if (!isAbsolute(this.executable)) throw new Error('Set an absolute path to the Codex executable.');
    await access(this.executable);
    const cwd = join(this.home, 'workspace');
    await mkdir(cwd, { recursive: true });
    // A separate CODEX_HOME prevents loading project/user hooks, MCP servers and plugins.
    // Users authenticate this isolated profile with the supplied login script.
    const features = ['shell_tool', 'shell_snapshot', 'unified_exec', 'hooks', 'plugins', 'apps', 'multi_agent', 'browser_use', 'computer_use', 'view_image', 'image_generation', 'memories', 'goals', 'code_mode', 'code_mode_host', 'skill_search'];
    const args = ['app-server', '--listen', 'stdio://', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0', '-c', 'mcp_servers={}', '-c', 'notify=[]'];
    for (const feature of features) args.push('-c', `features.${feature}=false`);
    this.process = this.spawnProcess(this.executable, args, { cwd, env: { ...process.env, CODEX_HOME: this.home }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.log('codex.spawned');
    this.process.on('error', e => { this.log('codex.spawn_failed', { error: errorCode(e) }, 'error'); this.failAll(new Error(`Codex could not start: ${e.message}`)); });
    this.process.on('exit', code => { this.log('codex.exited', { code }); this.failAll(new Error('Codex disconnected. Load again to reconnect.')); });
    this.process.stderr.on('data', () => {}); // Never forward raw CLI diagnostics or credentials to Chrome.
    this.reader = createInterface({ input: this.process.stdout });
    this.reader.on('line', line => { try { if (line.length > 2_000_000) throw new Error('Oversized Codex event.'); this.receive(JSON.parse(line)); } catch { this.failAll(new Error('Invalid Codex protocol output.')); this.process.kill(); } });
    await this.request('initialize', { clientInfo: { name: 'jobform_agent', title: 'Job Form Agent', version: this.clientVersion }, capabilities: { experimentalApi: false } });
    this.send({ method: 'initialized', params: {} });
    const params = { cwd, sandbox: 'read-only', approvalPolicy: 'never', developerInstructions: INSTRUCTIONS };
    const result = await this.request(resumeId ? 'thread/resume' : 'thread/start', resumeId ? { ...params, threadId: resumeId } : params);
    this.threadId = result.thread.id;
    return this.threadId;
  }
  send(message) { this.process.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.log('codex.rpc_sent', { requestId: String(id), operation: method.replaceAll('/', '.') });
      const timer = setTimeout(() => { this.log('codex.rpc_timeout', { requestId: String(id), operation: method.replaceAll('/', '.') }, 'error'); this.pending.delete(id); reject(new Error(`Codex ${method} timed out.`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  receive(message) {
    if (message.id !== undefined && message.method) {
      this.send({ id: message.id, error: { code: -32601, message: 'This integration does not permit tools or approvals.' } });
      return;
    }
    if (message.id !== undefined) {
      const call = this.pending.get(message.id);
      if (!call) return;
      clearTimeout(call.timer); this.pending.delete(message.id);
      this.log('codex.rpc_received', { requestId: String(message.id), error: message.error ? errorCode(message.error.message) : undefined }, message.error ? 'error' : 'info');
      if (message.error) call.reject(new Error(String(message.error.message).slice(0, 500))); else call.resolve(message.result);
      return;
    }
    const active = this.active;
    if (!active || message.params?.threadId !== this.threadId) return;
    if (!active.turnId) { active.early.push(message); return; }
    const params = message.params;
    if ((params.turnId ?? params.turn?.id) !== active.turnId) return;
    if (message.method === 'item/completed' && params.item?.type === 'agentMessage') active.lastMessage = params.item.text;
    if (message.method === 'item/agentMessage/delta') this.onProgress('Agent is preparing answers');
    if (message.method === 'turn/completed') {
      this.log('codex.turn_completed', { phase: params.turn.status, error: params.turn.error ? errorCode(params.turn.error.message) : undefined });
      clearTimeout(active.timer); this.active = null;
      if (params.turn.status !== 'completed') active.reject(new Error(params.turn.error?.message ?? 'Codex turn did not complete. Check login and model access.'));
      else { try { active.resolve(JSON.parse(active.lastMessage)); } catch { active.reject(new Error('Codex returned malformed structured output.')); } }
    }
  }
  turn(prompt, schema) {
    if (!this.threadId || this.active) return Promise.reject(new Error('Codex is disconnected or busy.'));
    return new Promise((resolve, reject) => {
      const active = { resolve, reject, early: [], lastMessage: '', turnId: null };
      this.active = active;
      active.timer = setTimeout(() => { this.interrupt(); }, 90000);
      this.request('turn/start', { threadId: this.threadId, input: [{ type: 'text', text: prompt }], outputSchema: schema }).then(result => {
        if (this.active !== active) return;
        active.turnId = result.turn.id;
        for (const event of active.early) this.receive(event);
      }).catch(error => { if (this.active === active) { clearTimeout(active.timer); this.active = null; reject(error); } });
    });
  }
  interrupt() {
    const active = this.active;
    if (!active) return;
    clearTimeout(active.timer); this.active = null;
    active.reject(new Error('Operation stopped or timed out.'));
    if (active.turnId) this.request('turn/interrupt', { threadId: this.threadId, turnId: active.turnId }).catch(() => this.close());
    else this.close();
  }
  failAll(error) {
    for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(error); }
    this.pending.clear();
    if (this.active) { clearTimeout(this.active.timer); this.active.reject(error); this.active = null; }
    this.threadId = null;
  }
  close() { this.failAll(new Error('Codex connection closed.')); this.reader?.close(); this.process?.kill(); }
}
