import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

async function executableFile(candidate) {
  try { return (await stat(candidate)).isFile() ? await realpath(candidate) : null; }
  catch { return null; }
}

export async function resolveCodex({ env = process.env, userHome = homedir(), platform = process.platform, arch = process.arch } = {}) {
  const filename = platform === 'win32' ? 'codex.exe' : 'codex';
  if (platform === 'win32' && ['x64', 'arm64'].includes(arch)) {
    const target = arch === 'arm64' ? 'windows-aarch64' : 'windows-x86_64';
    for (const editor of ['.vscode', '.vscode-insiders']) {
      const root = join(userHome, editor, 'extensions');
      let extensions;
      try { extensions = await readdir(root, { withFileTypes: true }); } catch { continue; }
      const candidates = extensions.filter(entry => entry.isDirectory() && /^openai\.chatgpt-\d/i.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name, 'en', { numeric: true }));
      for (const entry of candidates) {
        const found = await executableFile(join(root, entry.name, 'bin', target, filename));
        if (found) return found;
      }
    }
  }
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const entry of searchPath.split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, '$1');
    // Never search the current project via empty or relative PATH entries.
    if (!isAbsolute(directory)) continue;
    const found = await executableFile(join(directory, filename));
    if (found) return found;
  }

  throw new Error('Codex was not found. Install the Codex VS Code extension or add the folder containing codex.exe to PATH, then restart Chrome and click Load again.');
}
