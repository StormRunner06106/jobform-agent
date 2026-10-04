import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
export async function temporary(t) {
  const root = await mkdtemp(join(tmpdir(), 'jobform-test-'));
  t.after(async () => {
    const rel = relative(resolve(tmpdir()), resolve(root));
    if (isAbsolute(rel) || rel.startsWith('..') || !rel.startsWith('jobform-test-')) throw new Error('Unsafe temporary cleanup path.');
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
