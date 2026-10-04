import { readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function nextVersion(current) {
  if (current === null) return '0.0.1';
  if (!/^(0|[1-9]\d*)\.[0-9]\.[0-9]$/.test(current)) throw new Error('Invalid version; expected major.0-9.0-9.');
  let [major, minor, patch] = current.split('.').map(Number);
  if (++patch === 10) { patch = 0; if (++minor === 10) { minor = 0; major++; } }
  if (major > 65535) throw new Error('Chrome maximum major version reached.');
  return `${major}.${minor}.${patch}`;
}

export async function setVersion(root, command, message, now = new Date()) {
  if (!['start', 'next'].includes(command)) throw new Error('Use start or next explicitly.');
  if (typeof message !== 'string' || !message.trim() || /[\r\n]/.test(message)) throw new Error('Provide a one-line --message describing this release.');
  const lockPath = resolve(root, '.version.lock');
  const lock = await open(lockPath, 'wx').catch(() => { throw new Error('Version update already running; inspect .version.lock before retrying.'); });
  const originals = new Map();
  const temporary = [];
  const replaced = [];
  try {
    for (const name of ['version-state.json', 'package.json', 'extension/manifest.json', 'versions.md']) {
      originals.set(name, await readFile(resolve(root, name), 'utf8'));
    }
    const state = JSON.parse(originals.get('version-state.json'));
    if (!Array.isArray(state.entries) || state.current !== (state.entries.at(-1)?.version ?? null)) throw new Error('Version history is inconsistent.');
    let previous = null;
    for (const entry of state.entries) {
      if (entry.version !== nextVersion(previous)) throw new Error('Version history has a gap.');
      previous = entry.version;
    }
    if (command === 'start' && state.current !== null) throw new Error('Logging already started; use next.');
    if (command === 'next' && state.current === null) throw new Error('Logging has not started; use start when the user requests it.');
    const pkg = JSON.parse(originals.get('package.json'));
    const manifest = JSON.parse(originals.get('extension/manifest.json'));
    if (pkg.version !== (state.current ?? '0.0.0') || manifest.version !== (state.current ?? '0.0.0.1')) throw new Error('Manifest versions disagree with version-state.json.');
    state.current = nextVersion(state.current);
    state.entries.push({ version: state.current, date: now.toISOString(), message: message.trim() });
    pkg.version = manifest.version = state.current;
    manifest.version_name = state.current;
    const marker = '<!-- release-history -->';
    const intro = originals.get('versions.md').split(marker);
    if (intro.length !== 2) throw new Error('Missing or duplicate history marker in versions.md.');
    const header = intro[0].replace('Version logging has not started. No releases have been recorded.', 'Version logging is active. Releases are recorded only on explicit user request.');
    const history = [...state.entries].reverse().map(e => `## ${e.version} — ${e.date.slice(0, 10)}\n\n${e.message}`).join('\n\n');
    const outputs = new Map([
      ['version-state.json', JSON.stringify(state, null, 2) + '\n'],
      ['package.json', JSON.stringify(pkg, null, 2) + '\n'],
      ['extension/manifest.json', JSON.stringify(manifest, null, 2) + '\n'],
      ['versions.md', `${header}${marker}\n\n${history}\n`],
    ]);
    // Stage every file before replacement; roll back already replaced files on error.
    for (const [name, data] of outputs) {
      const temp = resolve(root, `${name}.version-tmp`);
      await writeFile(temp, data, { flag: 'wx' });
      temporary.push(temp);
    }
    for (const name of outputs.keys()) {
      await rename(resolve(root, `${name}.version-tmp`), resolve(root, name));
      replaced.push(name);
    }
    return state.current;
  } catch (error) {
    for (const name of replaced) await writeFile(resolve(root, name), originals.get(name));
    throw error;
  } finally {
    for (const path of temporary) await unlink(path).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command = 'status', flag, ...words] = process.argv.slice(2);
    if (command === 'status' && !flag) {
      const state = JSON.parse(await readFile(resolve(ROOT, 'version-state.json'), 'utf8'));
      console.log(state.current ? `Current release: ${state.current}` : 'Unreleased. Logging has not started.');
    } else {
      if (flag !== '--message') throw new Error('Usage: node scripts/version.mjs start|next --message "Release summary"');
      console.log(`Recorded ${await setVersion(ROOT, command, words.join(' '))}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
