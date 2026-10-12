import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { cachedImportWeight, createImportCache, type CachedImport } from '../../src/server/modules/imports/cache';
import { parseSheet, type ImportRow } from '../../src/server/modules/imports/parse-row';
import { readXlsx } from '../../src/server/modules/imports/xlsx-read';
import { excelSerial, FINMAP_LIKE_HEADERS, finmapLikeRow, finmapLikeXlsx } from '../helpers/finmap-like';

const CTX = { timezone: 'Asia/Almaty', baseCurrency: 'KZT', today: '2026-10-06' };

const item = (companyId: number, userId: number, name = 'f.xlsx'): CachedImport => ({
  companyId,
  userId,
  file: { name, size: 1, sha256: 'x' },
  parsed: { headerRow: 1, total: 0, rows: [], future: [], issues: [] },
});

const row = (n: number, comment: string | null): ImportRow => ({
  row: n,
  type: 'income',
  paidAt: '2026-10-05T05:00:00.000Z',
  date: '2026-10-05',
  minute: '2026-10-05 10:00',
  accrualDate: null,
  amount: '1500',
  baseAmount: null,
  account: { key: 'касса', name: 'Касса' },
  toAccount: null,
  category: 'Бар',
  subcategory: null,
  counterparty: null,
  project: null,
  tags: ['Смена'],
  comment,
});

/** Файл из rows строк с комментарием commentLength знаков. */
const sized = (companyId: number, rows: number, commentLength = 0): CachedImport => ({
  ...item(companyId, 1),
  parsed: { headerRow: 1, total: rows, rows: Array.from({ length: rows }, (_, i) => row(i + 2, commentLength ? 'к'.repeat(commentLength) : null)), future: [], issues: [] },
});

describe('кэш проверки (§6.3 спецификации импорта)', () => {
  it('токен — 128 бит; файл только своей компании и своего пользователя; remove удаляет', () => {
    const cache = createImportCache();
    const t = cache.put(item(1, 1));
    expect(t).toMatch(/^[0-9a-f]{32}$/);
    expect(cache.put(item(1, 2))).not.toBe(t);
    expect(cache.get(t, 1, 1)!.file.name).toBe('f.xlsx');
    expect(cache.get(t, 2, 1)).toBeNull();
    expect(cache.get(t, 1, 2)).toBeNull();
    expect(cache.get('нет', 1, 1)).toBeNull();
    cache.remove(t);
    expect(cache.get(t, 1, 1)).toBeNull();
  });

  it('срок — 30 минут с последнего обращения', () => {
    let clock = 0;
    const cache = createImportCache({ now: () => clock });
    const t = cache.put(item(1, 1));
    clock = 29 * 60_000;
    expect(cache.get(t, 1, 1)).not.toBeNull(); // обращение продлевает срок
    clock += 30 * 60_000;
    expect(cache.get(t, 1, 1)).not.toBeNull();
    clock += 30 * 60_000 + 1;
    expect(cache.get(t, 1, 1)).toBeNull();
    expect(cache.size()).toBe(0);
  });

  it('новая загрузка того же пользователя в ту же компанию заменяет прежнюю; больше 3 файлов — вытесняется самый давний', () => {
    let clock = 0;
    const cache = createImportCache({ now: () => clock++ });
    const first = cache.put(item(1, 1, 'старый'));
    const again = cache.put(item(1, 1, 'новый'));
    expect(cache.get(first, 1, 1)).toBeNull();
    expect(cache.get(again, 1, 1)!.file.name).toBe('новый');
    const b = cache.put(item(2, 1));
    const c = cache.put(item(3, 1));
    cache.get(again, 1, 1); // «новый» — свежий, самый давний теперь b
    const d = cache.put(item(4, 1));
    expect(cache.size()).toBe(3);
    expect(cache.get(b, 2, 1)).toBeNull();
    expect([again, c, d].map((t, i) => cache.get(t, [1, 3, 4][i]!, 1) !== null)).toEqual([true, true, true]);
  });

  it('вес файла: строки и тексты; сверх бюджета байтов вытесняются самые давние, новый файл остаётся даже один сверх бюджета', () => {
    // вес растёт со строками и с длиной текстов
    expect(cachedImportWeight(sized(1, 10))).toBeGreaterThan(cachedImportWeight(sized(1, 1)));
    expect(cachedImportWeight(sized(1, 10, 2000))).toBeGreaterThan(cachedImportWeight(sized(1, 10)) + 10 * 2000);
    const unit = cachedImportWeight(sized(1, 100));
    let clock = 0;
    // бюджет — на два с половиной файла: третий вытесняет самый давний, хотя предел 3 файлов не достигнут
    const cache = createImportCache({ now: () => clock++, maxBytes: Math.floor(unit * 2.5) });
    const a = cache.put(sized(1, 100));
    const b = cache.put(sized(2, 100));
    expect(cache.size()).toBe(2);
    const c = cache.put(sized(3, 100));
    expect(cache.size()).toBe(2);
    expect(cache.get(a, 1, 1)).toBeNull();
    expect(cache.get(b, 2, 1)).not.toBeNull();
    expect(cache.get(c, 3, 1)).not.toBeNull();
    // файл тяжелее всего бюджета: остальные вытеснены, он сам остаётся
    const huge = cache.put(sized(4, 300));
    expect(cache.size()).toBe(1);
    expect(cache.get(huge, 4, 1)!.parsed.rows).toHaveLength(300);
    // remove освобождает вес: снова помещаются два файла
    cache.remove(huge);
    cache.put(sized(5, 100));
    cache.put(sized(6, 100));
    expect(cache.size()).toBe(2);
  });

  it('кэш хранит отдельную копию разобранного файла: правка исходного объекта её не меняет (I2)', () => {
    const cache = createImportCache();
    const original = sized(1, 2, 5);
    const t = cache.put(original);
    const got = cache.get(t, 1, 1)!;
    expect(got.parsed).toEqual(original.parsed);
    expect(got.parsed).not.toBe(original.parsed);
    expect(got.parsed.rows[0]).not.toBe(original.parsed.rows[0]);
    original.parsed.rows[0]!.comment = 'изменён';
    expect(cache.get(t, 1, 1)!.parsed.rows[0]!.comment).toBe('ккккк');
  });

  it('лист с огромной нераспознанной колонкой: после сборки мусора кэш не держит распакованный текст листа (I2)', () => {
    v8.setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    // 500 строк по 30 000 знаков кириллицы в колонке Q без заголовка из §2.1: около 30 МБ текста листа. Названия и
    // комментарий длиннее 12 знаков — V8 хранит их срезами листа (короткие копирует)
    const filler = 'я'.repeat(30_000);
    const rows = Array.from({ length: 500 }, () => [
      ...finmapLikeRow({ paidAt: excelSerial('2026-10-05', '10:00:00'), amount: 1, from: 'Основная касса клуба', comment: 'Комментарий к строке' }),
      filler,
    ]);
    const file = finmapLikeXlsx(rows, { headers: [...FINMAP_LIKE_HEADERS, 'Лишняя'] });
    const cache = createImportCache();
    // разбор — в отдельной функции: после неё на исходный разбор ссылается только кэш
    const upload = () => cache.put({ companyId: 1, userId: 1, file: { name: 'f.xlsx', size: file.length, sha256: 'x' }, parsed: parseSheet(readXlsx(file), CTX) });
    // большой текст листа Node держит вне кучи V8 (external): считаются оба
    const used = () => {
      gc();
      gc();
      const m = process.memoryUsage();
      return m.heapUsed + m.external;
    };
    const before = used();
    upload();
    const retained = used() - before;
    expect(cache.size()).toBe(1);
    // без копии — около 29 МБ (весь лист), с копией — меньше 1 МБ
    expect(retained).toBeLessThan(10 * 1024 * 1024);
  });

  it('get возвращает только { companyId, userId, file, parsed } — без служебных полей кэша', () => {
    const cache = createImportCache();
    const it1 = item(1, 1);
    const t = cache.put(it1);
    const got = cache.get(t, 1, 1)!;
    expect(Object.keys(got).sort()).toEqual(['companyId', 'file', 'parsed', 'userId']);
    expect(got).toEqual(it1);
  });
});
