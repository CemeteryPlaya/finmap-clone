import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { chooseDelimiter, decodeCsv, parseCsv, readCsv } from '../../src/server/modules/imports/csv';
import { detectImportFile, readImportFile } from '../../src/server/modules/imports/read-file';
import type { SheetRow } from '../../src/server/modules/imports/xlsx-read';
import { finmapLikeXlsx } from '../helpers/finmap-like';
import { buildZip } from '../helpers/zip-build';

/** Текст в cp1251 (в Node нет кодировщика): ASCII как есть, А–я → C0–FF, Ё/ё → A8/B8. */
function cp1251(s: string): Buffer {
  return Buffer.from(
    [...s].map((ch) => {
      const c = ch.charCodeAt(0);
      if (c < 0x80) return c;
      if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
      if (ch === 'Ё') return 0xa8;
      if (ch === 'ё') return 0xb8;
      throw new Error(`нет в cp1251: ${ch}`);
    }),
  );
}
const utf16le = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]);
const values = (rows: SheetRow[]) => rows.map((r) => [r.row, Object.fromEntries([...r.cells].map(([c, v]) => [c, v.value]))]);

function f(code: string, fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).details).toEqual({ fileCode: code });
    return (e as AppError).message;
  }
  throw new Error(`ожидалась ${code}`);
}

const HEAD = 'Дата платежа*;Сумма в валюте счета*;Со счета*;На счет*;Комментарий';

describe('CSV (§2.5 спецификации импорта)', () => {
  it('кавычки по RFC 4180: "" внутри, разделитель и переводы строк внутри кавычек; CRLF; хвост после кавычки', () => {
    expect(parseCsv('a;"b;""c""";"d\r\ne"\r\nx;y\r\n', ';')).toEqual([
      ['a', 'b;"c"', 'd\r\ne'],
      ['x', 'y'],
    ]);
    expect(parseCsv('a,b\n"q"x,\n', ',')).toEqual([
      ['a', 'b'],
      ['qx', ''],
    ]);
    expect(parseCsv('1;2\n3;4\n5;6', ';', 2)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('разделитель: «;», «,» и табуляция — по числу распознанных заголовков; при равенстве — «;»', () => {
    const fields = ['Дата платежа', 'Сумма в валюте счета', 'На счет', 'Комментарий'];
    expect(chooseDelimiter(`${fields.join(';')}\n1;2;3;4`).delimiter).toBe(';');
    expect(chooseDelimiter(`${fields.join(',')}\n"1,5";2;3;4`).delimiter).toBe(',');
    expect(chooseDelimiter(`${fields.join('\t')}\n1\t2`).delimiter).toBe('\t');
    expect(chooseDelimiter('Дата платежа\n1').delimiter).toBe(';');
    // строка заголовков не первая: над ней — название отчёта
    expect(chooseDelimiter(`Отчёт за год\n\n${fields.join(',')}\n1,2,3,4`)).toEqual({ delimiter: ',', header: true });
  });

  it('кодировки: BOM UTF-8, UTF-16LE с BOM (табуляция), строгий UTF-8, cp1251', () => {
    expect(decodeCsv(Buffer.from(`\uFEFF${HEAD}`, 'utf8'))).toEqual({ text: HEAD, encoding: 'utf-8' });
    expect(decodeCsv(utf16le('а\tб'))).toEqual({ text: 'а\tб', encoding: 'utf-16le' });
    expect(decodeCsv(Buffer.from('Касса', 'utf8')).encoding).toBe('utf-8');
    expect(decodeCsv(cp1251('Касса Ёлка'))).toEqual({ text: 'Касса Ёлка', encoding: 'windows-1251' });
  });

  it('readCsv: номера строк — номера записей; значения — текст; пустые значения и строки не хранятся', () => {
    const csv = `Выгрузка\n${HEAD}\n05.10.2026 10:00;1 500,50;Касса;;"многострочный\nкомментарий"\n;;;;\n45569.43;10;;Банк;`;
    expect(values(readCsv(Buffer.from(csv, 'utf8')).rows)).toEqual([
      [1, { 0: 'Выгрузка' }],
      [2, { 0: 'Дата платежа*', 1: 'Сумма в валюте счета*', 2: 'Со счета*', 3: 'На счет*', 4: 'Комментарий' }],
      [3, { 0: '05.10.2026 10:00', 1: '1 500,50', 2: 'Касса', 4: 'многострочный\nкомментарий' }],
      [5, { 0: '45569.43', 1: '10', 3: 'Банк' }],
    ]);
    expect(readCsv(cp1251(`${HEAD}\n01.10.2026;5;Касса;;`)).rows[1]!.cells.get(2)).toEqual({ kind: 'text', value: 'Касса' });
    expect(readCsv(utf16le(`${HEAD.replaceAll(';', '\t')}\r\n01.10.2026\t5\tКасса`)).rows[1]!.cells.get(2)!.value).toBe('Касса');
  });

  it('незакрытая кавычка — F3; больше 64 полей — F3; cp1251 без заголовков — F8', () => {
    expect(f('F3', () => readCsv(Buffer.from(`${HEAD}\n"оборвано;1`, 'utf8')))).toBe('Файл повреждён или небезопасен: незакрытая кавычка в CSV');
    expect(f('F3', () => readCsv(Buffer.from(`${HEAD}\n${'1;'.repeat(64)}1`, 'utf8')))).toContain('больше 64 полей');
    expect(readCsv(Buffer.from(`${HEAD}\n${'1;'.repeat(63)}1`, 'utf8')).rows[1]!.cells.size).toBe(64);
    expect(f('F8', () => readCsv(cp1251('Дата;Сумма\n1;2')))).toBe('Не удалось прочитать CSV: сохраните его в UTF-8');
  });
});

describe('тип файла (§3.4)', () => {
  it('XLSX, старый .xls, CSV и TXT по имени, пустой файл, прочее', () => {
    expect(detectImportFile(finmapLikeXlsx(), 'файл.xlsx')).toBe('xlsx');
    expect(detectImportFile(finmapLikeXlsx(), 'без расширения')).toBe('xlsx');
    expect(f('F2', () => detectImportFile(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), 'старый.xls'))).toBe('Старый формат .xls — сохраните файл как .xlsx');
    expect(detectImportFile(Buffer.from(HEAD), 'выгрузка.CSV')).toBe('csv');
    expect(detectImportFile(Buffer.from(HEAD), 'выгрузка.txt')).toBe('csv');
    expect(detectImportFile(utf16le(HEAD), 'юникод.txt')).toBe('csv');
    expect(f('F2', () => detectImportFile(Buffer.from('a\u0000b'), 'x.csv'))).toBe('Нужен файл .xlsx или .csv');
    expect(f('F2', () => detectImportFile(Buffer.from(HEAD), 'x.pdf'))).toBe('Нужен файл .xlsx или .csv');
    expect(f('F1', () => detectImportFile(Buffer.alloc(0), 'x.csv'))).toBe('Файл пустой');
    // ZIP, но не книга Excel (например, .docx), — F2 от читателя книги
    expect(f('F2', () => readImportFile(buildZip([{ name: 'word/document.xml', data: '<w/>' }]), 'x.xlsx'))).toBe('Нужен файл .xlsx или .csv');
    expect(readImportFile(Buffer.from(`${HEAD}\n1;2;Касса;;`), 'x.csv').rows).toHaveLength(2);
  });

  it('пределы CSV: запись длиннее 1 МБ — F3; больше 50 010 непустых строк — F5 сразу', () => {
    expect(f('F3', () => readCsv(Buffer.from(`${HEAD}\n05.10.2026;1;К;;"${'к'.repeat(1_100_000)}"`, 'utf8')))).toBe(
      'Файл повреждён или небезопасен: строка CSV длиннее 1 МБ',
    );
    expect(f('F5', () => readCsv(Buffer.from(`${HEAD}\n${'05.10.2026;1;К;;\n'.repeat(50_010)}`, 'utf8')))).toBe(
      'В файле больше 50 000 строк — разбейте его по годам',
    );
    expect(readCsv(Buffer.from(`${HEAD}\n${'05.10.2026;1;К;;\n'.repeat(50_009)}`, 'utf8')).rows).toHaveLength(50_010);
  });

  it('подбор разделителя: предел строки при пробном разборе не ломает файл с «;» и 70 запятыми в комментарии', () => {
    const csv = `${HEAD}\n05.10.2026;1;Касса;;${'а,'.repeat(70)}б`;
    expect(chooseDelimiter(csv).delimiter).toBe(';');
    expect(readCsv(Buffer.from(csv, 'utf8')).rows[1]!.cells.get(4)!.value).toBe(`${'а,'.repeat(70)}б`);
    expect(parseCsv('a,b,c', ',', Infinity)).toEqual([['a', 'b', 'c']]);
    expect(parseCsv(`${'x,'.repeat(70)}x`, ',')).toEqual([]);
  });
});
