import { describe, expect, it } from 'vitest';
import {
  blockReason,
  checkStatus,
  checkSummary,
  createGroups,
  doneText,
  draftFromCard,
  existingAccountHint,
  importSizeError,
  isImportPreview,
  issueText,
  mappingFromDraft,
  needsRemembered,
  newAccountHint,
  NEW_ACCOUNT,
  requestMappings,
  signedMoney,
} from '../../src/client/lib/import-panel';
import type { AccountMapping, ImportPreview, ImportPreviewAccount } from '../../src/shared/schemas/imports';

const card = (over: Partial<ImportPreviewAccount> = {}): ImportPreviewAccount => ({
  key: 'касса',
  fileName: 'Касса',
  rows: 2,
  mapping: { key: 'касса', kind: 'existing', accountId: 7 },
  currency: 'KZT',
  movement: 1_000_000,
  existing: { balance: 50_000, openedAt: '2026-10-01', newOpenedAt: null },
  archivedHint: false,
  errors: [],
  ...over,
});

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  token: 'a'.repeat(32),
  file: { name: 'выгрузка.xlsx', size: 1000, rows: 16_028 },
  counts: { income: 9_812, expense: 6_104, transfer: 112, add: 16_028, duplicates: 0, skippedFuture: 0 },
  period: { from: '2023-03-15', to: '2026-10-11' },
  accounts: [card()],
  create: {
    categories: { total: 0, items: [] },
    counterparties: { total: 0, items: [] },
    projects: { total: 0, items: [] },
    tags: { total: 0, items: [] },
  },
  errors: { total: 0, byCode: [] },
  warnings: [],
  duplicates: { count: 0, rows: [] },
  canImport: true,
  revision: '0123456789abcdef',
  ...over,
});

describe('панель импорта: тексты (§5.3, §5.6 спецификации импорта)', () => {
  it('итог проверки, номера строк, размер файла', () => {
    expect(checkSummary(preview())).toBe('В файле 16\u202F028 операций: доходов 9\u202F812, расходов 6\u202F104, переводов 112. Период: 15.03.2023 – 11.10.2026');
    expect(checkSummary(preview({ file: { name: 'ф', size: 1, rows: 1 }, counts: { income: 1, expense: 0, transfer: 0, add: 0, duplicates: 1, skippedFuture: 0 }, period: null }))).toBe(
      'В файле 1 операция: доходов 1, расходов 0, переводов 0',
    );
    expect(issueText({ code: 'R01', message: 'Нет даты платежа', count: 7, rows: [15, 230, 231] })).toBe('Нет даты платежа — строки 15, 230, 231 и ещё 4');
    expect(issueText({ code: 'R04', message: 'Нет суммы', count: 1, rows: [9] })).toBe('Нет суммы — строка 9');
    expect(issueText({ code: 'W8', message: 'Этот файл уже импортирован', count: 1, rows: [] })).toBe('Этот файл уже импортирован');
    expect(importSizeError(30 * 1024 * 1024)).toBeNull();
    expect(importSizeError(30 * 1024 * 1024 + 1)).toBe('Файл больше 30 МБ');
  });

  it('причина недоступности «Импортировать» и живая область', () => {
    expect(blockReason(preview(), { refreshing: false, invalidCards: [] })).toBeNull();
    expect(checkStatus(preview())).toBe('Проверка завершена: ошибок нет, можно импортировать');
    expect(blockReason(preview(), { refreshing: true, invalidCards: [] })).toBe('Проверяем изменения…');
    expect(blockReason(preview(), { refreshing: false, invalidCards: ['Банк'] })).toBe('Проверьте сумму в карточке счёта «Банк»');
    const withErrors = preview({ errors: { total: 23, byCode: [] }, canImport: false });
    expect(blockReason(withErrors, { refreshing: false, invalidCards: [] })).toBe('Исправьте ошибки в файле и загрузите его снова');
    expect(checkStatus(withErrors)).toBe('Найдено ошибок: 23');
    const unchosen = preview({ accounts: [card({ mapping: null, currency: null, errors: [{ code: 'A1', message: 'Выберите счёт для «Касса» — подходит несколько' }] })], canImport: false });
    expect(blockReason(unchosen, { refreshing: false, invalidCards: [] })).toBe('Выберите счёт для «Касса»');
    const archived = preview({ accounts: [card({ errors: [{ code: 'A5', message: 'Счёт «Касса» в архиве — выберите другой' }] })], canImport: false });
    expect(blockReason(archived, { refreshing: false, invalidCards: [] })).toBe('Исправьте ошибку в карточке счёта «Касса»: Счёт «Касса» в архиве — выберите другой');
    // устаревший «новый счёт» (R3): карточка с A1 и непустым сопоставлением — состояние по mapping, текст сервера
    const stale = preview({ accounts: [card({ errors: [{ code: 'A1', message: 'Счёт «Касса» уже есть в компании — проверка обновлена, выберите его' }] })], canImport: false });
    expect(blockReason(stale, { refreshing: false, invalidCards: [] })).toBe('Исправьте ошибку в карточке счёта «Касса»: Счёт «Касса» уже есть в компании — проверка обновлена, выберите его');
    const dup = preview({ counts: { income: 1, expense: 0, transfer: 0, add: 0, duplicates: 1, skippedFuture: 0 }, canImport: false });
    expect(blockReason(dup, { refreshing: false, invalidCards: [] })).toBe('Нечего импортировать: все строки — дубликаты');
    expect(checkStatus(dup)).toBe('Проверка завершена. Нечего импортировать: все строки — дубликаты');
  });

  it('«Будет создано»: категории по видам с родителем, контрагенты с типом, «и ещё N», пустые группы скрыты', () => {
    const groups = createGroups(
      preview({
        create: {
          categories: {
            total: 203,
            items: [
              { name: 'Бар', kind: 'income', rows: 3 },
              { name: 'Администраторы', kind: 'expense', parent: 'Зарплата', rows: 2 },
            ],
          },
          counterparties: { total: 1, items: [{ name: 'Сотрудник А', type: 'employee', rows: 2 }] },
          projects: { total: 0, items: [] },
          tags: { total: 1, items: [{ name: 'Ночь', rows: 1 }] },
        },
      }),
    );
    expect(groups).toEqual([
      {
        key: 'categories',
        title: 'Категории',
        total: 203,
        sections: [
          { title: 'Доходы', items: [{ name: 'Бар' }] },
          { title: 'Расходы', items: [{ name: 'Зарплата → Администраторы' }] },
        ],
        more: 201,
      },
      { key: 'counterparties', title: 'Контрагенты', total: 1, sections: [{ title: null, items: [{ name: 'Сотрудник А', note: 'Сотрудник' }] }], more: 0 },
      { key: 'tags', title: 'Теги', total: 1, sections: [{ title: null, items: [{ name: 'Ночь' }] }], more: 0 },
    ]);
  });

  it('суммы карточки: движение со знаком, стартовый баланс и остаток после импорта по обоим режимам', () => {
    expect(signedMoney(1_014_981_300, 'KZT')).toBe('+10\u202F149\u202F813\u00A0₸');
    expect(signedMoney(-250_000, 'KZT')).toBe('\u22122\u202F500\u00A0₸');
    expect(newAccountHint(null, 400_000, 'KZT')).toBe('Остаток после импорта: ₸\u00A04\u202F000');
    expect(newAccountHint({ mode: 'current', amount: 1_000_000 }, 400_000, 'KZT')).toBe('Стартовый баланс: ₸\u00A06\u202F000');
    expect(newAccountHint({ mode: 'start', amount: 1_000_000 }, 400_000, 'KZT')).toBe('Остаток после импорта: ₸\u00A014\u202F000');
    expect(newAccountHint({ mode: 'current', amount: 0 }, 400_000, 'KZT')).toBe('Стартовый баланс: \u2212₸\u00A04\u202F000');
    expect(existingAccountHint(null, 50_000, 1_000_000, 'KZT')).toBe('Пусто — после импорта остаток ₸\u00A010\u202F500');
  });

  it('итог записи: созданное без нулей, склонения', () => {
    const counts = { rows: 16_028, income: 1, expense: 1, transfer: 0, added: 16_028, duplicates: 0, skippedFuture: 0 };
    const result = (created: { accounts: number; categories: number; counterparties: number; projects: number; tags: number }) => ({
      import: { id: 1, fileName: 'ф', fileSize: 1, status: 'done' as const, createdAt: '2026-10-12T10:00:00.000Z', counts, created },
      counts,
    });
    expect(doneText(result({ accounts: 2, categories: 37, counterparties: 86, projects: 0, tags: 1 }))).toBe(
      'Добавлено 16\u202F028 операций. Создано: 2 счёта, 37 категорий, 86 контрагентов, 1 тег. Пропущено дубликатов: 0',
    );
    expect(doneText(result({ accounts: 0, categories: 0, counterparties: 0, projects: 1, tags: 0 }))).toBe('Добавлено 16\u202F028 операций. Создано: 1 проект. Пропущено дубликатов: 0');
    expect(doneText(result({ accounts: 0, categories: 0, counterparties: 0, projects: 0, tags: 0 }))).toBe('Добавлено 16\u202F028 операций. Пропущено дубликатов: 0');
  });
});

describe('панель импорта: сопоставление счетов (§5.4)', () => {
  it('черновик карточки из сопоставления сервера и обратно', () => {
    expect(draftFromCard(card(), 'KZT')).toEqual({ choice: 7, name: 'Касса', currency: 'KZT', mode: 'current', amount: '', target: '' });
    const fresh = card({ key: 'банк', fileName: 'Банк', mapping: { key: 'банк', kind: 'new', name: 'Банк', currency: 'USD', balance: { mode: 'start', amount: 150_050 } }, currency: 'USD' });
    expect(draftFromCard(fresh, 'KZT')).toEqual({ choice: NEW_ACCOUNT, name: 'Банк', currency: 'USD', mode: 'start', amount: '1\u202F500,50', target: '' });
    expect(draftFromCard(card({ mapping: null, currency: null }), 'KZT')).toMatchObject({ choice: null, currency: 'KZT' });

    expect(mappingFromDraft('банк', { choice: NEW_ACCOUNT, name: 'Банк', currency: 'USD', mode: 'current', amount: ' 1 500,5 ', target: '' }, null)).toEqual({
      mapping: { key: 'банк', kind: 'new', name: 'Банк', currency: 'USD', balance: { mode: 'current', amount: 150_050 } },
      error: null,
    });
    expect(mappingFromDraft('банк', { choice: NEW_ACCOUNT, name: 'Банк', currency: 'KZT', mode: 'start', amount: '', target: '' }, null).mapping).toMatchObject({ balance: null });
    expect(mappingFromDraft('банк', { choice: NEW_ACCOUNT, name: 'Банк', currency: 'KZT', mode: 'start', amount: '12abc', target: '' }, null)).toEqual({
      mapping: null,
      error: 'Введите сумму, например 1 500,50',
    });
    expect(mappingFromDraft('касса', { choice: 7, name: 'Касса', currency: 'KZT', mode: 'current', amount: '', target: '\u22121 000' }, 'KZT')).toEqual({
      mapping: { key: 'касса', kind: 'existing', accountId: 7, targetBalance: -100_000 },
      error: null,
    });
    expect(mappingFromDraft('касса', { choice: 7, name: 'Касса', currency: 'KZT', mode: 'current', amount: '', target: '' }, 'KZT').mapping).toEqual({
      key: 'касса',
      kind: 'existing',
      accountId: 7,
      targetBalance: null,
    });
    expect(mappingFromDraft('касса', { choice: null, name: 'Касса', currency: 'KZT', mode: 'current', amount: '', target: '' }, null)).toEqual({ mapping: null, error: null });
  });

  it('выбор по ключу переживает «Выбрать другой файл»: в запросе — выбор человека, иначе то, что показал сервер; A1 не отправляется', () => {
    const chosen: AccountMapping = { key: 'касса', kind: 'existing', accountId: 9 };
    const choices = new Map<string, AccountMapping>([
      ['касса', chosen],
      ['чужой', { key: 'чужой', kind: 'existing', accountId: 1 }],
    ]);
    const p = preview({
      accounts: [card(), card({ key: 'банк', fileName: 'Банк', mapping: { key: 'банк', kind: 'new', name: 'Банк', currency: 'KZT', balance: null } }), card({ key: 'сейф', mapping: null })],
    });
    expect(requestMappings(p, choices)).toEqual([chosen, { key: 'банк', kind: 'new', name: 'Банк', currency: 'KZT', balance: null }]);
    expect(needsRemembered(p, choices)).toBe(true);
    expect(needsRemembered(p, new Map([['касса', { key: 'касса', kind: 'existing', accountId: 7 }]]))).toBe(false);
    expect(needsRemembered(p, new Map())).toBe(false);
  });

  it('свежий предпросмотр в ответе 409/422 распознаётся', () => {
    expect(isImportPreview(preview())).toBe(true);
    expect(isImportPreview({ token: 'x' })).toBe(false);
    expect(isImportPreview(null)).toBe(false);
    // ошибки, счётчики и «Будет создано» — тоже по типу: панель показывает их без проверок
    expect(isImportPreview({ ...preview(), errors: { total: '1', byCode: [] } })).toBe(false);
    expect(isImportPreview({ ...preview(), counts: null })).toBe(false);
    expect(isImportPreview({ ...preview(), create: { ...preview().create, tags: { total: 0 } } })).toBe(false);
  });
});
