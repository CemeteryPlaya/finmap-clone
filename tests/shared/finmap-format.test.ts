import { describe, expect, it } from 'vitest';
import {
  columnTitle,
  countKnownHeaders,
  FINMAP_COLUMNS,
  headerField,
  headerKey,
  isHeaderRow,
  nameKey,
  repairName,
  systemKeyOf,
} from '../../src/shared/finmap-format';
import { FINMAP_LIKE_HEADERS } from '../helpers/finmap-like';

describe('формат Finmap: колонки и ключи (§2.1, §2.2, §4.9 спецификации импорта)', () => {
  it('16 колонок A–P в порядке шаблона; звёздочки у обязательных; названия для сообщений без звёздочки', () => {
    expect(FINMAP_COLUMNS).toHaveLength(16);
    expect(FINMAP_COLUMNS.map((c) => c.header).filter((h) => h.endsWith('*'))).toEqual(['Дата платежа*', 'Сумма в валюте счета*', 'Со счета*', 'На счет*']);
    expect(columnTitle('fromAccount')).toBe('Со счета');
    expect(columnTitle('periodFrom')).toBe('Период начисления (дата "с")');
  });

  it('headerKey: латинские двойники, регистр, «ё», звёздочки, кавычки любого вида, невидимые символы и пробелы', () => {
    expect(headerKey('Со счёта*')).toBe(headerKey('со счета'));
    expect(headerKey('\u0043о \u0063ч\u0065т\u0061')).toBe(headerKey('Со счета')); // «Со счета» с латинскими C, c, e, a
    expect(headerKey('Период начисления (дата «с»)')).toBe(headerKey('Период начисления (дата "с")'));
    expect(headerKey('  Дата\u200B  платежа * ')).toBe('дата платежа');
    expect(FINMAP_LIKE_HEADERS.map(headerField)).toEqual(FINMAP_COLUMNS.map((c) => c.field));
    expect(headerField('Сумма')).toBeNull();
  });

  it('строка заголовков: нужны «Дата платежа» и «Сумма в валюте счета»; счёт распознанных колонок', () => {
    expect(isHeaderRow(['Дата платежа*', 'Сумма в валюте счета*'])).toBe(true);
    expect(isHeaderRow(['Дата платежа*', 'Со счета*'])).toBe(false);
    expect(countKnownHeaders([...FINMAP_LIKE_HEADERS])).toBe(16);
    expect(countKnownHeaders(['Теги', 'теги', 'Прочее'])).toBe(1);
  });

  it('nameKey: «Kacca», «КАССА», «касса» совпадают; регистр латиницы не мешает; «Kaspi» и «Каспи» — разные', () => {
    expect(nameKey('\u004B\u0061\u0063\u0063\u0061')).toBe(nameKey('касса')); // «Касса» латиницей: K, a, c, c, a
    expect(nameKey('КАССА')).toBe(nameKey('Касса'));
    expect(nameKey('  Касса\u00A0 1 ')).toBe(nameKey('касса 1'));
    expect(nameKey('Ёлка')).toBe(nameKey('елка'));
    expect(nameKey('STEAM')).toBe(nameKey('Steam'));
    expect(nameKey('Kaspi')).toBe(nameKey('kaspi'));
    expect(nameKey('Kaspi')).not.toBe(nameKey('Каспи'));
  });

  it('repairName: в словах с кириллицей двойники — кириллицей; латинские слова не трогаются', () => {
    expect(repairName('\u004B\u0061\u0063с\u0061')).toBe('Касса'); // смесь алфавитов: латинские K, a, c, a
    expect(repairName('Kaspi')).toBe('Kaspi');
    expect(repairName('Steam PC')).toBe('Steam PC');
    expect(repairName('\u004Bасса Kaspi')).toBe('Касса Kaspi');
    expect(repairName('  Зарплата\u200B ')).toBe('Зарплата');
    expect(nameKey(repairName('\u004B\u0061\u0063с\u0061'))).toBe(nameKey('\u004B\u0061\u0063с\u0061'));
  });

  it('системные категории по названию и виду; системное название с чужим видом — не системное', () => {
    expect(systemKeyOf('Зарплата', 'expense')).toBe('salary');
    expect(systemKeyOf('ЗАРПЛАТА', 'expense')).toBe('salary');
    expect(systemKeyOf('Инвестиции', 'income')).toBe('investment');
    expect(systemKeyOf('Зарплата', 'income')).toBeNull();
    expect(systemKeyOf('Аренда', 'expense')).toBeNull();
  });
});
