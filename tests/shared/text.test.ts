import { describe, expect, it } from 'vitest';
import { foldCase, matchesQuery } from '../../src/shared/search';
import { cleanName, nameField } from '../../src/shared/text';

describe('cleanName', () => {
  it('убирает невидимые символы, схлопывает пробелы, обрезает края, нормализует NFC', () => {
    expect(cleanName('  Клуб\u200B  на\u00A0Ленина\uFEFF ')).toBe('Клуб на Ленина');
    expect(cleanName('\u200B\u200C\u200D\u2060\u00AD')).toBe('');
    expect(cleanName('e\u0301')).toBe('\u00E9');
  });

  it('nameField проверяет длину уже очищенного названия', () => {
    const f = nameField(5);
    expect(f.safeParse(' абв\u200B ').data).toBe('абв');
    expect(f.safeParse('\u200B').error?.issues[0]?.message).toBe('Введите название');
    expect(f.safeParse('абвгде').error?.issues[0]?.message).toBe('Не длиннее 5 символов');
    expect(nameField(5, 'Введите имя').safeParse('').error?.issues[0]?.message).toBe('Введите имя');
  });
});

describe('foldCase / matchesQuery', () => {
  it('без учёта регистра и «ё»', () => {
    expect(foldCase('ЁЛКА Ёж')).toBe('елка еж');
    expect(matchesQuery('ИП Иванов', 'иван')).toBe(true);
    expect(matchesQuery('Ёлка', 'ЕЛК')).toBe(true);
    expect(matchesQuery('Ромашка', 'лютик')).toBe(false);
    expect(matchesQuery('что угодно', '   ')).toBe(true);
  });
});
