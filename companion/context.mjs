import { readdir, realpath, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const skip = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor']);
export function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
const hash = value => createHash('sha256').update(value).digest('hex');
export async function loadContext(input) {
  if (!path.isAbsolute(input)) throw new Error('Choose an absolute knowledge-folder path.');
  const root = await realpath(input);
  if (!(await stat(root)).isDirectory()) throw new Error('Knowledge path must be a folder.');
  const documents = [];
  let bytes = 0, seen = 0, skipped = 0;
  async function walk(dir, depth) {
    if (depth > 8) { skipped++; return; }
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (++seen > 2000) throw new Error('Folder is too large. Choose a smaller knowledge folder.');
      if (entry.name.startsWith('.') || skip.has(entry.name) || entry.isSymbolicLink()) { skipped++; continue; }
      const absolute = await realpath(path.join(dir, entry.name));
      if (!inside(root, absolute)) throw new Error('A source resolves outside the selected folder.');
      if (entry.isDirectory()) { await walk(absolute, depth + 1); continue; }
      if (!entry.isFile() || !/\.(md|txt)$/i.test(entry.name) || /^(agents|claude|skill)\.md$/i.test(entry.name)) { skipped++; continue; }
      const info = await stat(absolute);
      if (info.size > 256_000) { skipped++; continue; }
      if (documents.length >= 200 || bytes + info.size > 2_000_000) throw new Error('Knowledge exceeds 200 files or 2 MB. Select a smaller folder.');
      const text = await readFile(absolute, 'utf8');
      if (text.includes('\0')) { skipped++; continue; }
      bytes += Buffer.byteLength(text);
      documents.push({ id: `source-${documents.length + 1}`, relative: path.relative(root, absolute), absolute, text, hash: hash(text) });
    }
  }
  await walk(root, 0);
  if (!documents.length) throw new Error('No usable Markdown or text knowledge was found.');
  return { root, documents, skipped, fingerprint: hash(documents.map(d => d.relative + d.hash).sort().join('\n')) };
}
export async function verifyContext(context) {
  const current = await loadContext(context.root);
  if (current.fingerprint !== context.fingerprint) throw new Error('Knowledge changed. Click Load again before continuing.');
}
export function retrieve(context, questions) {
  const words = new Set(questions.flatMap(q => `${q.label} ${q.help ?? ''}`.toLowerCase().match(/[a-z]{3,}/g) ?? []));
  return context.documents.map(d => ({ d, score: (/profile|resume|work.history/i.test(d.relative) ? 10 : 0) + [...words].filter(w => d.text.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score).slice(0, 8).map(({ d }) => ({ id: d.id, source: d.relative, excerpt: d.text.slice(0, 4000) }));
}
