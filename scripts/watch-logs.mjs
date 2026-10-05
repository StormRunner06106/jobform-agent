import { createServer } from 'node:http';
import { readFile, open, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appendDiagnostic, logDirectory } from '../companion/logging.mjs';
import { safeRecord } from '../extension/diagnostics.js';

export function createLogReceiver({ origins, directory = logDirectory, onRecord = row => console.log(JSON.stringify(row)) }) {
  const seen = new Set();
  return createServer(async (req, res) => {
    if (!origins.includes(req.headers.origin)) { res.writeHead(403).end(); return; }
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204).end(); return;
    }
    if (req.method !== 'POST' || req.url !== '/events') { res.writeHead(404).end(); return; }
    try {
      let body = '', bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 256_000) { res.writeHead(413).end(); return; }
        body += chunk;
      }
      const rows = JSON.parse(body);
      if (!Array.isArray(rows) || rows.length > 300) throw new Error('Invalid log batch');
      for (const input of rows) {
        const row = safeRecord(input);
        if (!row.id || !row.event || seen.has(row.id)) continue;
        appendDiagnostic('extension.jsonl', row, directory);
        seen.add(row.id);
        if (seen.size > 4000) seen.delete(seen.values().next().value);
        onRecord(row);
      }
      res.writeHead(204).end();
    } catch { res.writeHead(400).end(); }
  });
}

async function main() {
  const manifest = JSON.parse((await readFile(join(logDirectory, '../native/host.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const origins = manifest.allowed_origins.map(origin => origin.replace(/\/$/, ''));
  const server = createLogReceiver({ origins });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Log watcher already running on 127.0.0.1:43189.' : error.message); process.exitCode = 1; });
  server.listen(43189, '127.0.0.1', () => console.log(`Watching extension and companion logs in ${logDirectory}\nReload the extension, reopen its panel, then click Load knowledge.`));
  let offset = 0, reading = false, remainder = '';
  const file = join(logDirectory, 'companion.jsonl');
  const timer = setInterval(async () => {
    if (reading || !server.listening) return;
    reading = true;
    try {
      const info = await stat(file);
      if (info.size < offset) { offset = 0; remainder = ''; }
      const handle = await open(file, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(info.size - offset, 1_100_000));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        offset += bytesRead;
        const lines = (remainder + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
        remainder = lines.pop();
        for (const line of lines) if (line) console.log(line);
      } finally { await handle.close(); }
    } catch (error) { if (error.code !== 'ENOENT') console.error('Unable to read companion logs: ' + error.code); }
    finally { reading = false; }
  }, 500);
  timer.unref();
  process.on('SIGINT', () => { clearInterval(timer); server.close(); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
