import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * §2.1 этапа 1.5: в том, что видит человек (и в комментариях — чтобы проверка была простой), слова «статья»
 * нет ни в одной форме. Идентификаторы (`category*`) — английские, их проверка не касается.
 */
const WORD = /(?<![\p{L}\p{N}_])[Сс]тат(?:ья|ьи|ью|ье|ьёй|ьей|ей|ьям|ьями|ьях)(?![\p{L}\p{N}_])/gu;
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.html', '.css', '.md']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function hits(file: string): string[] {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const found: string[] = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(WORD)) found.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${m[0]}`);
  });
  return found;
}

describe('терминология (§2.1 этапа 1.5)', () => {
  it('в src, scripts и README нет слова «статья» ни в одной форме', () => {
    const files = [...walk(path.resolve('src')), ...walk(path.resolve('scripts')), path.resolve('README.md')];
    expect(files.length).toBeGreaterThan(50);
    expect(files.flatMap(hits)).toEqual([]);
  });

  it('проверка находит все формы и не путает слова-соседи', () => {
    // слова собраны из частей: файл теста не должен сам попасть под замену скриптом
    const stem = ['С', 'тат'].join('');
    for (const ending of ['ья', 'ьи', 'ью', 'ье', 'ьёй', 'ьей', 'ей', 'ьям', 'ьями', 'ьях']) {
      for (const word of [stem + ending, stem.toLowerCase() + ending]) expect(`«${word}»`.match(WORD), word).not.toBeNull();
    }
    for (const word of ['остаться', 'достаться', 'статус', 'статистика', 'постатейно', 'состатья']) {
      expect(word.match(WORD), word).toBeNull();
    }
  });
});
