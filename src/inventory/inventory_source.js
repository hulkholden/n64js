import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Also recorded for standalone captures, so a dirty checkout is reproducible
// to the same standard as a batch scan. Keep the hashing format stable.
export async function sourceHash() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  async function sources(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await sources(path));
      else if (entry.isFile() && path.endsWith('.js') && !path.endsWith('.test.js')) files.push(path);
    }
    return files;
  }
  const files = await sources(join(root, 'src'));
  files.push(join(root, 'package.json'), join(root, 'bun.lock'));
  const hash = createHash('sha256');
  for (const path of files.sort()) hash.update(relative(root, path) + '\0').update(await readFile(path)).update('\0');
  return hash.digest('hex');
}
