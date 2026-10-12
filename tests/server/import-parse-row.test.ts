import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/server/errors';
import { groupIssues, type RowIssue } from '../../src/server/modules/imports/errors';
import {
  decimalToMinor,
  findHeader,
  fromExcelSerial,
  parseCellNumber,
  parseSheet,
  parseTextAmount,
  parseWallTime,
  type ParseContext,
} from '../../src/server/modules/imports/parse-row';
import { CELL_TOO_LONG, readXlsx, type Cell, type SheetRow } from '../../src/server/modules/imports/xlsx-read';
import { FINMAP_COLUMNS, type FinmapField } from '../../src/shared/finmap-format';
import { excelSerial, finmapLikeXlsx } from '../helpers/finmap-like';

const CTX: ParseContext = { timezone: 'Asia/Almaty', baseCurrency: 'KZT', today: '2026-10-06', date1904: false };
const COL = Object.fromEntries(FINMAP_COLUMNS.map((c, i) => [c.field, i])) as Record<FinmapField, number>;
const text = (value: string): Cell => ({ kind: 'text', value });
const num = (value: number | string): Cell => ({ kind: 'number', value: String(value) });

/** Строка листа по полям: строка — текст, число — число Excel. */
function row(n: number, v: Partial<Record<FinmapField, string | number | Cell>>): SheetRow {
  const cells = new Map<number, Cell>();
  for (const [f, x] of Object.entries(v)) cells.set(COL[f as FinmapField], typeof x === 'string' ? text(x) : typeof x === 'number' ? num(x) : x);
  return { row: n, cells };
}
const HEADER = row(1, Object.fromEntries(FINMAP_COLUMNS.map((c) => [c.field, c.header])));
/** Разбор строк данных под стандартными заголовками. */
const parse = (...rows: SheetRow[]) => parseSheet({ rows: [HEADER, ...rows], date1904: false }, CTX);
/** Замечания одной строки: «код: текст». */
const issuesOf = (...data: Partial<Record<FinmapField, string | number | Cell>>[]) =>
  parse(...data.map((d, i) => row(i + 2, d))).issues.map((i) => `${i.code}: ${i.message}`);
const BASE = { paidAt: '05.10.2026 10:00', amount: '100' } as const;

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

describe('суммы (§4.2 спецификации импорта)', () => {
  it('число ячейки — точно, без parseFloat: экспонента, хвосты float до 15 значащих цифр, минус', () => {
    expect(parseCellNumber('10596')).toEqual({ negative: false, value: '10596' });
    expect(parseCellNumber('8200.5')).toEqual({ negative: false, value: '8200.5' });
    expect(parseCellNumber('1.2345E+5')).toEqual({ negative: false, value: '123450' });
    expect(parseCellNumber('1E-3')).toEqual({ negative: false, value: '0.001' });
    expect(parseCellNumber('1317.0000000000002')).toEqual({ negative: false, value: '1317' });
    expect(parseCellNumber('12345678901234567')).toEqual({ negative: false, value: '12345678901234600' });
    expect(parseCellNumber('-8500')).toEqual({ negative: true, value: '8500' });
    expect(parseCellNumber('-0')).toEqual({ negative: false, value: '0' });
    expect(parseCellNumber('abc')).toBeNull();
    expect(parseCellNumber('1E+999')).toBeNull();
  });

  it('текст: пробелы, U+00A0, U+202F и ₸; минус «-» и «\u2212», плюс; точка и запятая вместе; один знак — десятичный', () => {
    expect(parseTextAmount('1 500,50')).toEqual({ negative: false, value: '1500.5' });
    expect(parseTextAmount('1\u00A0500.5\u00A0₸')).toEqual({ negative: false, value: '1500.5' });
    expect(parseTextAmount('1\u202F234\u202F567,89')).toEqual({ negative: false, value: '1234567.89' });
    expect(parseTextAmount('1,234,567.89')).toEqual({ negative: false, value: '1234567.89' });
    expect(parseTextAmount('1.234.567,89')).toEqual({ negative: false, value: '1234567.89' });
    expect(parseTextAmount('\u22121 500 ₸')).toEqual({ negative: true, value: '1500' });
    expect(parseTextAmount('-10')).toEqual({ negative: true, value: '10' });
    expect(parseTextAmount('+10')).toEqual({ negative: false, value: '10' });
    expect(parseTextAmount(',5')).toEqual({ negative: false, value: '0.5' });
    for (const bad of ['1.234.567', '1,2,3', '1.2,3.4', 'abc', '', '-', '1e5', '10 тенге']) expect(parseTextAmount(bad), bad).toBeNull();
  });

  it('минимальные единицы: half-up, признак округления (W10), KZT, JPY, KWD, переполнение', () => {
    expect(decimalToMinor('8200.5', 2)).toEqual({ minor: 820050, rounded: false });
    expect(decimalToMinor('0.125', 2)).toEqual({ minor: 13, rounded: true });
    expect(decimalToMinor('0.124', 2)).toEqual({ minor: 12, rounded: true });
    expect(decimalToMinor('1234.5', 0)).toEqual({ minor: 1235, rounded: true });
    expect(decimalToMinor('1.2345', 3)).toEqual({ minor: 1235, rounded: true });
    expect(decimalToMinor('1.5', 3)).toEqual({ minor: 1500, rounded: false });
    expect(decimalToMinor('90071992547409.91', 2)).toEqual({ minor: Number.MAX_SAFE_INTEGER, rounded: false });
    expect(decimalToMinor('90071992547409.92', 2)).toBeNull();
  });
});

describe('даты (§4.3)', () => {
  it('число Excel: доля суток до секунды, 86 400 секунд — следующие сутки, date1904', () => {
    expect(fromExcelSerial(excelSerial('2026-10-03', '22:07:00'), false)).toEqual({ date: '2026-10-03', seconds: 22 * 3600 + 7 * 60 });
    expect(fromExcelSerial(46298.50001, false)).toEqual({ date: '2026-10-03', seconds: 43201 });
    expect(fromExcelSerial(46298.9999999, false)).toEqual({ date: '2026-10-04', seconds: 0 });
    expect(fromExcelSerial(46300, true)).toEqual({ date: '2030-10-06', seconds: 0 });
    expect(fromExcelSerial(-1, false)).toBeNull();
    expect(fromExcelSerial(3_000_000, false)).toBeNull();
    // ошибка Excel 1900 года: число 60 — несуществующее 29.02.1900; первая принимаемая дата — 01.03.1900
    expect(fromExcelSerial(60, false)).toBeNull();
    expect(fromExcelSerial(61, false)).toEqual({ date: '1900-03-01', seconds: 0 });
    // date1904: последнее число Excel плюс 1 462 дня — за 31.12.9999
    expect(fromExcelSerial(2_958_465, true)).toBeNull();
    expect(fromExcelSerial(2_958_465 - 1462, true)).toEqual({ date: '9999-12-31', seconds: 0 });
    expect(fromExcelSerial(2_958_465.9999999, false)).toBeNull();
    expect(parseWallTime(text('28.02.1900'), false)).toBeNull();
  });

  it('текст: д.м.гггг, дд-мм-гггг, дд/мм/гггг, время через пробел или T, ISO, число текстом; 31.02 и 24:00 — нет', () => {
    const w = (v: string) => parseWallTime(text(v), false);
    expect(w('5.10.2026')).toEqual({ date: '2026-10-05', seconds: 0 });
    expect(w('05-10-2026 9:05')).toEqual({ date: '2026-10-05', seconds: 9 * 3600 + 300 });
    expect(w('05/10/2026T09:05:07')).toEqual({ date: '2026-10-05', seconds: 9 * 3600 + 307 });
    expect(w('01.09.2026 00:00:00')).toEqual({ date: '2026-09-01', seconds: 0 });
    expect(w('30.09.2026 23:59:59')).toEqual({ date: '2026-09-30', seconds: 86_399 });
    expect(w('2026-10-05')).toEqual({ date: '2026-10-05', seconds: 0 });
    expect(w('2026-10-05T10:00:00.000')).toEqual({ date: '2026-10-05', seconds: 36_000 });
    expect(w('46300.5')).toEqual({ date: '2026-10-05', seconds: 43_200 });
    expect(parseWallTime(num('46300.25'), false)).toEqual({ date: '2026-10-05', seconds: 21_600 });
    for (const bad of ['31.02.2026', '05.10.2026 24:00', '05.13.2026', 'вчера', '2026-10-5', '05.10.26']) expect(w(bad), bad).toBeNull();
  });

  it('граница суток в APP_TIMEZONE: 23:30 и 00:30 по Алматы, 2023 год — UTC+6; будущая дата — W1 и строка пропущена; год 1989 — R03', () => {
    const p = parse(
      row(2, { paidAt: '05.10.2026 23:30', amount: 1, fromAccount: 'Касса' }),
      row(6, { paidAt: '15.06.2023 23:30', amount: 1, fromAccount: 'Касса' }),
      row(3, { paidAt: '06.10.2026 00:30', amount: 1, fromAccount: 'Касса' }),
      row(4, { paidAt: '07.10.2026 00:00', amount: 'не сумма', fromAccount: 'Касса' }),
      row(5, { paidAt: '31.12.1989', amount: 1, fromAccount: 'Касса' }),
    );
    expect(p.rows.map((r) => [r.paidAt, r.date, r.minute])).toEqual([
      ['2026-10-05T18:30:00.000Z', '2026-10-05', '2026-10-05 23:30'],
      // до 01.03.2024 Алматы жил по UTC+6: 23:30 — это 17:30 UTC
      ['2023-06-15T17:30:00.000Z', '2023-06-15', '2023-06-15 23:30'],
      ['2026-10-05T19:30:00.000Z', '2026-10-06', '2026-10-06 00:30'],
    ]);
    expect(p.future).toEqual([4]);
    expect(p.issues).toEqual([
      { code: 'W1', message: 'Дата платежа в будущем — плановые операции появятся позже, строки пропущены', row: 4 },
      { code: 'R03', message: 'Дата платежа раньше 1990 года', row: 5 },
    ]);
    expect(p.total).toBe(5);
  });
});

describe('строки (§4.1, §4.3–§4.8)', () => {
  it('файл «как у Finmap»: заголовки с двойниками, доход, зарплата с периодом текстом, перевод, расход с копейками и тегами', () => {
    const p = parseSheet(readXlsx(finmapLikeXlsx()), CTX);
    expect(p.headerRow).toBe(1);
    expect(p.issues).toEqual([]);
    expect(p.rows).toEqual([
      {
        row: 2,
        type: 'income',
        paidAt: '2026-10-03T17:07:00.000Z',
        date: '2026-10-03',
        minute: '2026-10-03 22:07',
        accrualDate: null,
        amount: '10596',
        baseAmount: 1059600,
        account: { key: 'касса-1', name: 'Касса-1' },
        toAccount: null,
        category: 'Бар',
        subcategory: null,
        counterparty: null,
        project: null,
        tags: [],
        comment: null,
      },
      expect.objectContaining({
        row: 3,
        type: 'expense',
        minute: '2026-10-03 22:07',
        accrualDate: '2026-09-01',
        amount: '8500',
        account: { key: 'касса-1', name: 'Касса-1' },
        category: 'Зарплата',
        subcategory: 'Администраторы',
        counterparty: 'Сотрудник А',
      }),
      expect.objectContaining({ row: 4, type: 'transfer', account: { key: 'касса-1', name: 'Касса-1' }, toAccount: { key: 'банк-2', name: 'Банк-2' } }),
      expect.objectContaining({
        row: 5,
        type: 'expense',
        paidAt: '2026-10-04T19:30:00.000Z',
        accrualDate: '2026-10-01',
        amount: '8200.5',
        baseAmount: 820050,
        tags: ['Смена', 'Ночь'],
        comment: 'Аренда за октябрь',
      }),
    ]);
  });

  it('тип по «Со счета» / «На счет»: расход, доход, перевод; пусто — R08; одинаковые по ключу — R09', () => {
    const p = parse(
      row(2, { ...BASE, fromAccount: 'Касса' }),
      row(3, { ...BASE, toAccount: 'Касса' }),
      row(4, { ...BASE, fromAccount: 'Касса', toAccount: 'Банк' }),
      row(5, { ...BASE }),
      row(6, { ...BASE, fromAccount: 'Касса', toAccount: 'КАССА' }),
    );
    expect(p.rows.map((r) => [r.type, r.account.name, r.toAccount?.name ?? null])).toEqual([
      ['expense', 'Касса', null],
      ['income', 'Касса', null],
      ['transfer', 'Касса', 'Банк'],
    ]);
    expect(p.issues.map((i) => [i.code, i.row])).toEqual([
      ['R08', 5],
      ['R09', 6],
    ]);
  });

  it('суммы в строке: пусто R04, не число R05, ноль R06, минус у расхода — модуль, у дохода — R10; F округляется с W10, ноль F — как пусто', () => {
    const p = parse(
      row(2, { paidAt: '05.10.2026', fromAccount: 'Касса' }),
      row(3, { paidAt: '05.10.2026', amount: '12 тыс', fromAccount: 'Касса' }),
      row(4, { paidAt: '05.10.2026', amount: '0,00', fromAccount: 'Касса' }),
      row(5, { paidAt: '05.10.2026', amount: -8500, fromAccount: 'Касса' }),
      row(6, { paidAt: '05.10.2026', amount: '-100', toAccount: 'Касса' }),
      row(7, { paidAt: '05.10.2026', amount: '1', baseAmount: '475,125', fromAccount: 'Касса' }),
      row(8, { paidAt: '05.10.2026', amount: '1', baseAmount: 0, fromAccount: 'Касса' }),
    );
    expect(p.issues.map((i) => `${i.row} ${i.code}: ${i.message}`)).toEqual([
      '2 R04: Нет суммы',
      '3 R05: Не удалось прочитать сумму «12 тыс»',
      '4 R06: Сумма равна нулю',
      '6 R10: Отрицательная сумма у дохода',
      '7 W10: Больше 2 знаков после запятой — сумма округлена',
    ]);
    expect(p.rows.map((r) => [r.row, r.amount, r.baseAmount])).toEqual([
      [5, '8500', null],
      [7, '1', 47513],
      [8, '1', null],
    ]);
  });

  it('дата начисления: B; C — начало периода; B и C — B и W6; D раньше C — R11; неразборчивые — R11; у перевода — W3', () => {
    const p = parse(
      row(2, { ...BASE, fromAccount: 'К', accrualDate: '30.09.2026' }),
      row(3, { ...BASE, fromAccount: 'К', periodFrom: '01.09.2026 00:00:00', periodTo: '30.09.2026 23:59:59' }),
      row(4, { ...BASE, fromAccount: 'К', accrualDate: num(excelSerial('2026-09-15', '12:00:00')), periodFrom: '01.09.2026' }),
      row(5, { ...BASE, fromAccount: 'К', periodFrom: '01.10.2026', periodTo: '30.09.2026' }),
      row(6, { ...BASE, fromAccount: 'К', accrualDate: 'сентябрь' }),
      row(7, { ...BASE, fromAccount: 'К', toAccount: 'Б', periodFrom: '01.09.2026' }),
      row(8, { ...BASE, fromAccount: 'К', accrualDate: num(60) }),
      row(9, { ...BASE, fromAccount: 'К', periodTo: num(2_958_466) }),
    );
    expect(p.rows.map((r) => [r.row, r.accrualDate])).toEqual([
      [2, '2026-09-30'],
      [3, '2026-09-01'],
      [4, '2026-09-15'],
      [7, null],
    ]);
    expect(p.issues.map((i) => `${i.row} ${i.code}: ${i.message}`)).toEqual([
      '4 W6: Есть и дата начисления, и период — взята дата начисления',
      '5 R11: Конец периода раньше начала',
      '6 R11: Не удалось прочитать дату начисления «сентябрь»',
      '7 W3: У перевода нет даты начисления — она не перенесена',
      '8 R11: Не удалось прочитать дату начисления «60»',
      '9 R11: Не удалось прочитать конец периода начисления «2958466»',
    ]);
  });

  it('категория, подконтрагент, проект, теги, комментарий; у перевода категория и контрагент не переносятся (W2), проект — да', () => {
    const p = parse(
      row(2, { ...BASE, fromAccount: 'К', category: ' Зарплата ', subcategory: 'Админ', counterparty: 'Отдел', subcounterparty: 'Сотрудник А', project: 'Клуб', subproject: 'Зал', tags: 'Смена, смена ,, Ночь', comment: '  текст  ' }),
      row(3, { ...BASE, fromAccount: 'К', toAccount: 'Б', category: 'Перевод', counterparty: 'Банк', project: 'Клуб' }),
      row(4, { ...BASE, fromAccount: 'К', subcategory: 'Без родителя' }),
    );
    expect(p.rows[0]).toMatchObject({ category: 'Зарплата', subcategory: 'Админ', counterparty: 'Сотрудник А', project: 'Клуб', tags: ['Смена', 'Ночь'], comment: 'текст' });
    expect(p.rows[1]).toMatchObject({ type: 'transfer', category: null, subcategory: null, counterparty: null, project: 'Клуб' });
    expect(p.issues.map((i) => `${i.row} ${i.code}`)).toEqual(['2 W4', '2 W5', '3 W2', '4 R12']);
  });

  it('пределы: названия (R13), 20 тегов (R14), комментарий 2 000 / 2 001 (R15), ошибка Excel и длинная ячейка (R18)', () => {
    expect(
      issuesOf(
        { ...BASE, fromAccount: 'К', category: 'к'.repeat(101), counterparty: 'к'.repeat(201), project: 'п'.repeat(101), tags: 'т'.repeat(51) },
        { ...BASE, fromAccount: 'К', tags: Array.from({ length: 21 }, (_, i) => `т${i}`).join(',') },
        { ...BASE, fromAccount: 'К', comment: 'к'.repeat(2001) },
        { ...BASE, fromAccount: 'К', amount: { kind: 'error', value: '#N/A' } },
        { ...BASE, fromAccount: 'К', comment: { kind: 'error', value: CELL_TOO_LONG } },
      ),
    ).toEqual([
      'R13: Категория длиннее 100 символов',
      'R13: Контрагент длиннее 200 символов',
      'R13: Проект длиннее 100 символов',
      'R13: Тег длиннее 50 символов',
      'R14: Больше 20 тегов',
      'R15: Комментарий длиннее 2 000 символов',
      'R18: Ошибка Excel #N/A в колонке «Сумма в валюте счета»',
      'R18: Ячейка длиннее 32 767 символов',
    ]);
    expect(issuesOf({ ...BASE, fromAccount: 'К', comment: 'к'.repeat(2000), tags: Array.from({ length: 20 }, (_, i) => `т${i}`).join(',') })).toEqual([]);
  });

  it('дата платежа: пусто — R01, неразборчиво — R02 со значением', () => {
    expect(issuesOf({ amount: 1, fromAccount: 'К' }, { paidAt: '31.02.2026', amount: 1, fromAccount: 'К' })).toEqual([
      'R01: Нет даты платежа',
      'R02: Не удалось прочитать дату платежа «31.02.2026»',
    ]);
  });
});

describe('файл целиком (§2.2, §2.3, §4.10)', () => {
  it('заголовки в любом порядке, строки над ними, незнакомая колонка — W7; пустые строки не считаются', () => {
    const head: SheetRow = { row: 3, cells: new Map([[0, text('Сумма в валюте счета')], [2, text('\u0048а счет')], [3, text('Примечание')], [5, text('Дата платежа')]]) };
    const p = parseSheet(
      {
        date1904: false,
        rows: [
          { row: 1, cells: new Map([[0, text('Выгрузка')]]) },
          head,
          { row: 4, cells: new Map([[0, num(10)], [2, text('Касса')], [5, text('05.10.2026')]]) },
          { row: 5, cells: new Map([[0, text('   ')], [3, text('только неизвестная колонка')]]) },
        ],
      },
      CTX,
    );
    expect(p).toMatchObject({ headerRow: 3, total: 1, rows: [{ row: 4, type: 'income', amount: '10' }] });
    expect(p.issues).toEqual([{ code: 'W7', message: 'Колонка «Примечание» не распознана — пропущена', row: 3 }]);
  });

  it('нет заголовков, нет счёта, повтор колонки — F6; заголовки ниже 10-й строки не ищутся; нет данных — F7; больше 50 000 — F5', () => {
    const F6 = 'Не найдена строка заголовков: нужны колонки «Дата платежа» и «Сумма в валюте счета» и хотя бы одна из «Со счета», «На счет»';
    expect(f('F6', () => findHeader([row(1, { paidAt: 'Дата', amount: 'Сумма' })]))).toBe(F6);
    expect(f('F6', () => findHeader([row(1, { paidAt: 'Дата платежа', amount: 'Сумма в валюте счета' })]))).toBe(F6);
    expect(f('F6', () => findHeader([{ ...HEADER, row: 11 }]))).toBe(F6);
    const twice: SheetRow = { row: 1, cells: new Map([...HEADER.cells, [16, text('Со счёта*')]]) };
    expect(f('F6', () => findHeader([twice]))).toBe('Колонка «Со счета» встречается дважды');
    expect(f('F7', () => parse(row(2, { comment: ' ' })))).toBe('В файле нет операций');
    const many = Array.from({ length: 50_001 }, (_, i) => row(i + 2, { ...BASE, fromAccount: 'К' }));
    expect(f('F5', () => parse(...many))).toBe('В файле больше 50 000 строк — разбейте его по годам');
  });

  it('группы замечаний: код и текст, число и до 20 первых номеров по возрастанию', () => {
    const issues: RowIssue[] = [
      ...Array.from({ length: 25 }, (_, i) => ({ code: 'R04' as const, message: 'Нет суммы', row: 100 - i })),
      { code: 'R17', message: 'Категория «А» в архиве — верните из архива', row: 3 },
      { code: 'R17', message: 'Категория «Б» в архиве — верните из архива', row: 2 },
      { code: 'W8', message: 'Этот файл уже импортирован', row: 0 },
    ];
    const g = groupIssues(issues);
    expect(g.map((x) => [x.code, x.message.slice(0, 15), x.count, x.rows.length])).toEqual([
      ['W8', 'Этот файл уже и', 1, 0],
      ['R17', 'Категория «Б» в', 1, 1],
      ['R17', 'Категория «А» в', 1, 1],
      ['R04', 'Нет суммы', 25, 20],
    ]);
    expect(g[3]!.rows).toEqual(Array.from({ length: 20 }, (_, i) => 76 + i));
  });
});
