import fs from 'node:fs';
import path from 'node:path';

function newestMtime(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let max = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    max = Math.max(max, entry.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return max;
}

export function needsClientBuild(root: string): boolean {
  const index = path.join(root, 'dist', 'client', 'index.html');
  if (!fs.existsSync(index)) return true;
  const built = fs.statSync(index).mtimeMs;
  const sources = Math.max(newestMtime(path.join(root, 'src', 'client')), newestMtime(path.join(root, 'src', 'shared')));
  return sources > built;
}
