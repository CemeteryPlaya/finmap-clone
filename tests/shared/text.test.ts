import { describe, expect, it } from 'vitest';
import { foldCase, matchesQuery } from '../../src/shared/search';
import { cleanName, nameField } from '../../src/shared/text';

describe('cleanName', () => {
  it('убирает невидимые символы, схлопывает пробелы, обрезает края, нормализует NFC', () => {
    expect(cleanName('  Клуб​  на Ленина﻿ ')).toBe('Клуб на Ленина');
    expect(cleanName('​‌‍⁠­')).toBe('');
    expect(cleanName('é')).toBe('é');
  });

  it('nameField проверяет длину уже очищенного названия', () => {
    const f = nameField(5);
    expect(f.safeParse(' абв​ ').data).toBe('абв');
    expect(f.safeParse('​').error?.issues[0]?.message).toBe('Введите название');
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
