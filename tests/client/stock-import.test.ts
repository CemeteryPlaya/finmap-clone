import { describe, expect, it } from 'vitest';
import { chosenFileText, importFileError, importSummary, stockTemplateHref } from '../../src/client/lib/stock-import';
import type { StockImportResult } from '../../src/shared/schemas/stock';

const result = (over: Partial<StockImportResult> = {}): StockImportResult => ({
  rows: 4,
  errors: [],
  errorsTotal: 0,
  create: { items: 2, groups: 1, suppliers: 1 },
  names: { items: ['Сок', 'Жвачка'], groups: ['Напитки'], suppliers: ['Поставщик Б'] },
  skip: { items: 1 },
  docs: 3,
  lines: 4,
  total: 12_500_000,
  committed: false,
  ...over,
});

describe('импорт склада: тексты проверки (§9.1, Склад-2)', () => {
  it('каталог: строки, «Будет создано» с названиями, «Уже есть»', () => {
    expect(importSummary(result(), 'items', 'KZT')).toEqual([
      'Строк в файле: 4',
      'Товаров будет создано: 2 — Сок, Жвачка',
      'Групп будет создано: 1 — Напитки',
      'Уже есть в каталоге (пропуск): 1',
    ]);
  });

  it('поступления: документы, строки и сумма, новые товары и поставщики; больше 100 названий — «и ещё»', () => {
    const many = Array.from({ length: 100 }, (_, i) => `Товар ${i}`);
    expect(importSummary(result({ create: { items: 130, groups: 0, suppliers: 1 }, names: { items: many, groups: [], suppliers: ['Поставщик Б'] } }), 'receipts', 'KZT')).toEqual([
      'Строк в файле: 4',
      'Документов: 3, строк: 4, на сумму 125\u202F000\u00A0₸',
      `Товаров будет создано: 130 — ${many.join(', ')} и ещё 30`,
      'Поставщиков будет создано: 1 — Поставщик Б',
    ]);
  });

  it('ошибка файла — понятным текстом', () => {
    expect(importFileError({ status: 413, message: 'x' })).toBe('Файл больше 5 МБ — разделите его на части');
    expect(importFileError({ status: 422, message: 'В файле больше 5 000 строк' })).toBe('В файле больше 5 000 строк');
  });
});

describe('окно импорта склада: файл и шаблон (план 2026-10-20, задача 7)', () => {
  it('ссылка на шаблон и подпись выбранного файла', () => {
    expect(stockTemplateHref(5, 'items')).toBe('/api/v1/companies/5/stock/import/items/template.xlsx');
    expect(stockTemplateHref(5, 'receipts')).toBe('/api/v1/companies/5/stock/import/receipts/template.xlsx');
    expect(chosenFileText(null)).toBe('Файл не выбран');
    expect(chosenFileText({ name: 'каталог.xlsx' })).toBe('каталог.xlsx');
  });
});
