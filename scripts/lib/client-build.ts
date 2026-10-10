import fs from 'node:fs';
import path from 'node:path';

/** Файлы и папки, от которых зависит сборка интерфейса. */
const INPUTS = ['src/client', 'src/shared', 'vite.config.ts', 'package-lock.json', 'tsconfig.json'];

/** Новейшее время изменения: у папки учитывается и её собственное (удаление и переименование файлов меняют его). */
function newestMtime(p: string): number {
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return 0;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  let max = st.mtimeMs;
  for (const entry of fs.readdirSync(p)) max = Math.max(max, newestMtime(path.join(p, entry)));
  return max;
}

export function needsClientBuild(root: string): boolean {
  const index = path.join(root, 'dist', 'client', 'index.html');
  if (!fs.existsSync(index)) return true;
  const built = fs.statSync(index).mtimeMs;
  const sources = Math.max(...INPUTS.map((rel) => newestMtime(path.join(root, rel))));
  return sources > built;
}
