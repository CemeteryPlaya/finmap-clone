import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { needsClientBuild } from '../../scripts/lib/client-build';

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-cb-'));
  for (const d of ['src/client', 'src/shared', 'dist/client']) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}
const touch = (p: string, t: number) => {
  fs.writeFileSync(p, 'x');
  fs.utimesSync(p, t, t);
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
    expect(needsClientBuild(root)).toBe(false);
    touch(path.join(root, 'src/shared/currencies.ts'), 3000);
    expect(needsClientBuild(root)).toBe(true);
  });
});
