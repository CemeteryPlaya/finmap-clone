import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { needsClientBuild } from '../../scripts/lib/client-build';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

const DIRS = ['src/client', 'src/client/pages', 'src/shared', 'src/templates', 'dist/client'];

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-cb-'));
  roots.push(root);
  for (const d of DIRS) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}
const touch = (p: string, t: number) => {
  fs.writeFileSync(p, 'x');
  fs.utimesSync(p, t, t);
};
/** Время папок: создание файлов в тесте сдвигает его на «сейчас». */
const ageDirs = (root: string, t: number) => {
  for (const d of DIRS) fs.utimesSync(path.join(root, d), t, t);
};

describe('needsClientBuild', () => {
  it('true, если сборки нет', () => {
    const root = tree();
    touch(path.join(root, 'src/client/main.tsx'), 1000);
    expect(needsClientBuild(root)).toBe(true);
  });

  it('false, если сборка новее исходников, и true, если исходник изменился позже', () => {
    const root = tree();
    touch(path.join(root, 'src/client/main.tsx'), 1000);
    touch(path.join(root, 'dist/client/index.html'), 2000);
    ageDirs(root, 1000);
    expect(needsClientBuild(root)).toBe(false);
    touch(path.join(root, 'src/shared/currencies.ts'), 3000);
    ageDirs(root, 1000);
    expect(needsClientBuild(root)).toBe(true);
  });

  it('удалённый файл (git pull) — пересборка: время папки новее сборки', () => {
    const root = tree();
    touch(path.join(root, 'src/client/pages/Old.tsx'), 1000);
    touch(path.join(root, 'dist/client/index.html'), 2000);
    ageDirs(root, 1000);
    expect(needsClientBuild(root)).toBe(false);
    fs.rmSync(path.join(root, 'src/client/pages/Old.tsx'));
    fs.utimesSync(path.join(root, 'src/client/pages'), 3000, 3000);
    expect(needsClientBuild(root)).toBe(true);
  });

  it('изменённые vite.config.ts или package-lock.json (новые зависимости) — пересборка', () => {
    for (const file of ['vite.config.ts', 'package-lock.json']) {
      const root = tree();
      touch(path.join(root, 'src/client/main.tsx'), 1000);
      touch(path.join(root, file), 1000);
      touch(path.join(root, 'dist/client/index.html'), 2000);
      ageDirs(root, 1000);
      expect(needsClientBuild(root)).toBe(false);
      touch(path.join(root, file), 3000);
      expect(needsClientBuild(root)).toBe(true);
    }
  });

  it('изменённый шаблон (src/templates) — пересборка: форма проекта берёт из него схему параметров', () => {
    const root = tree();
    touch(path.join(root, 'src/client/main.tsx'), 1000);
    touch(path.join(root, 'src/templates/club.ts'), 1000);
    touch(path.join(root, 'dist/client/index.html'), 2000);
    ageDirs(root, 1000);
    expect(needsClientBuild(root)).toBe(false);
    touch(path.join(root, 'src/templates/club.ts'), 3000);
    ageDirs(root, 1000);
    expect(needsClientBuild(root)).toBe(true);
  });
});
