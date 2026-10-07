import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { benchDirProblem } from '../../scripts/lib/bench-gate';

const made: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'finmap-gate-'));
  made.push(d);
  return d;
};
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('замер журнала: проверка папки до записи', () => {
  it('нет папки или пустая папка — можно заливать свежую копию', () => {
    const base = tmp();
    expect(benchDirProblem(path.join(base, 'нет'), path.join(base, 'data'), false)).toBeNull();
    const empty = path.join(base, 'пусто');
    fs.mkdirSync(empty);
    expect(benchDirProblem(empty, path.join(base, 'data'), false)).toBeNull();
  });

  it('папка с чужими файлами без app.db — отказ: свежая копия заливается только в пустое место', () => {
    const base = tmp();
    fs.writeFileSync(path.join(base, 'notes.txt'), 'x');
    expect(benchDirProblem(base, path.join(base, 'data'), false)).toMatch(/не пуста/);
  });

  it('папка данных приложения — отказ, в том числе при ином написании пути; на Windows регистр не важен', () => {
    const base = tmp();
    const data = path.join(base, 'Data');
    expect(benchDirProblem(data, data, true)).toMatch(/папка данных приложения/);
    expect(benchDirProblem(path.join(data, '..', 'Data'), data, true)).toMatch(/папка данных приложения/);
    expect(benchDirProblem(data.toUpperCase(), data, true, 'win32')).toMatch(/папка данных приложения/);
    expect(benchDirProblem(data.toUpperCase(), data, true, 'linux')).toBeNull();
  });

  it('путь — файл, а не папка: отказ', () => {
    const base = tmp();
    const file = path.join(base, 'f');
    fs.writeFileSync(file, 'x');
    expect(benchDirProblem(file, path.join(base, 'data'), false)).toMatch(/не папка/);
  });
});
