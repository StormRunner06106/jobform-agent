import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { safeRecord } from '../extension/diagnostics.js';

export const logDirectory = join(process.env.LOCALAPPDATA ?? homedir(), 'jobform-agent', 'logs');
export function appendDiagnostic(filename, record, directory = logDirectory) {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, filename);
  try { if (statSync(path).size > 1_000_000) renameSync(path, `${path}.1`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  appendFileSync(path, JSON.stringify(safeRecord(record)) + '\n', 'utf8');
}
export function log(event, details = {}, level = 'info') {
  const row = { ...details, id: randomUUID(), time: new Date().toISOString(), source: 'companion', event, level, pid: process.pid };
  try { appendDiagnostic('companion.jsonl', row); } catch { /* Diagnostics must never corrupt native stdout or stop filling. */ }
}
