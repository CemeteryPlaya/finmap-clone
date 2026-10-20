import fs from 'node:fs';
import path from 'node:path';
import { assertKey, type FileStore, type StoredFile } from './store';

/** Хранилище в папке на диске (локальный режим): ключ — путь внутри root. */
export function createLocalStore(root: string): FileStore {
  const fileOf = (key: string) => {
    assertKey(key);
    return path.join(root, ...key.split('/'));
  };

  function walk(dir: string, prefix: string, out: StoredFile[]) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, key, out);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        out.push({ key, size: stat.size, uploadedAt: stat.mtime });
      }
    }
  }

  return {
    async put(key, data) {
      const file = fileOf(key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    },
    async get(key) {
      const file = fileOf(key);
      return fs.existsSync(file) ? fs.readFileSync(file) : null;
    },
    async remove(key) {
      fs.rmSync(fileOf(key), { force: true });
    },
    async list(prefix) {
      const out: StoredFile[] = [];
      walk(root, '', out);
      return out.filter((f) => f.key.startsWith(prefix)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },
    async downloadUrl() {
      return null;
    },
  };
}
