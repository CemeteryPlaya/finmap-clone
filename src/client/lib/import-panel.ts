import { getCurrency, isKnownCurrency } from '../../shared/currencies';
import { formatDateRu } from '../../shared/dates';
import { COUNTERPARTY_TYPE_SINGULAR } from '../../shared/counterparties';
import { formatAmount, formatMoney, MONEY_SCREEN, MONEY_SCREEN_BEFORE, parseAmount } from '../../shared/money';
import type {
  AccountMapping,
  ImportCommitResult,
  ImportCreatedCounts,
  ImportIssueGroup,
  ImportPreview,
  ImportPreviewAccount,
} from '../../shared/schemas/imports';
import { api } from './api';
import { uploadMode, uploadToBlob } from './blob-upload';
import { invalidateOperations } from './journal-mutations';
import { pluralRu } from './journal-format';
import { queryClient } from './query';

/**
 * Панель «Импорт из Excel» (§5 спецификации импорта): чистые функции состояния и текстов (тесты — в node без DOM)
 * и запросы к API импорта.
 */

/** Предел файла (§2.4): больше — отказ в браузере, до загрузки. */
export const IMPORT_MAX_BYTES = 30 * 1024 * 1024;
/** Подсказка окна выбора файла. */
export const IMPORT_ACCEPT = '.xlsx,.csv';
/** Пункт «Создать новый счёт» в поле «Счёт» карточки (id справочников всегда положительные). */
export const NEW_ACCOUNT = -1;
/** Пауза перед пересчётом предпросмотра после правки карточки счёта (§5.3). */
export const PREVIEW_DEBOUNCE_MS = 300;

/** Ошибка размера до загрузки; null — размер подходит. */
export function importSizeError(size: number): string | null {
  return size > IMPORT_MAX_BYTES ? 'Файл больше 30 МБ' : null;
}

/** «1 234» — разряды узким неразрывным пробелом, как у сумм. */
export const formatCount = (n: number) => formatAmount(n, 0);

/** Номера строк группы: «строка 15», «строки 15, 230, 231 и ещё 4»; без номеров (W8) — пусто. */
export function issueRowsText(g: Pick<ImportIssueGroup, 'count' | 'rows'>): string {
  if (g.rows.length === 0) return '';
  const more = g.count - g.rows.length;
  return `${g.rows.length === 1 && more === 0 ? 'строка' : 'строки'} ${g.rows.join(', ')}${more > 0 ? ` и ещё ${formatCount(more)}` : ''}`;
}

/** Пункт списка ошибок и предупреждений (§5.3): «Нет даты платежа — строки 15, 230, 231 и ещё 4». */
export function issueText(g: ImportIssueGroup): string {
  const rows = issueRowsText(g);
  return rows ? `${g.message} — ${rows}` : g.message;
}

/** «1 234 операции», «25 операций», «1 операция». */
export const operationsText = (n: number) => `${formatCount(n)} ${pluralRu(n, 'операция', 'операции', 'операций')}`;
const fileRows = (n: number) => `${formatCount(n)} ${pluralRu(n, 'строка', 'строки', 'строк')}`;

/**
 * Первая строка итога (§5.3): «В файле 1 234 операции: доходов 700, расходов 500, переводов 34. Период: 09.01.2024 – 30.09.2026».
 * Всего — все непустые строки данных; части складываются в него: строки с ошибками разбора и плановые (дата позже сегодня)
 * добавляются в конец («, с ошибками 3», «, плановых 2»), и тогда вместо «операций» — «строк» (R6).
 */
export function checkSummary(p: ImportPreview): string {
  const c = p.counts;
  const period = p.period ? `. Период: ${formatDateRu(p.period.from)} – ${formatDateRu(p.period.to)}` : '';
  const unread = Math.max(0, p.file.rows - c.income - c.expense - c.transfer - c.skippedFuture);
  const extra = `${unread > 0 ? `, с ошибками ${formatCount(unread)}` : ''}${c.skippedFuture > 0 ? `, плановых ${formatCount(c.skippedFuture)}` : ''}`;
  const total = extra ? fileRows(p.file.rows) : operationsText(p.file.rows);
  return `В файле ${total}: доходов ${formatCount(c.income)}, расходов ${formatCount(c.expense)}, переводов ${formatCount(c.transfer)}${extra}${period}`;
}

/**
 * Ошибки в карточке счёта: первая карточка с ошибкой и её текст. Состояние карточки — по mapping (R4): mapping null —
 * счёт не выбран; иначе текст ошибки сервера (в том числе A1 устаревшего «нового счёта»).
 */
function firstAccountError(p: ImportPreview): { card: ImportPreviewAccount; message: string } | null {
  for (const card of p.accounts) {
    if (card.mapping === null) return { card, message: `Выберите счёт для «${card.fileName}»` };
    if (card.errors.length > 0) return { card, message: `Исправьте ошибку в карточке счёта «${card.fileName}»: ${card.errors[0]!.message}` };
  }
  return null;
}

/**
 * Почему «Импортировать» недоступна (§5.3 п. 6); null — можно импортировать. invalidCards — названия карточек, где
 * сумма введена с ошибкой (она ещё не ушла на сервер).
 */
export function blockReason(p: ImportPreview, opts: { refreshing: boolean; invalidCards: readonly string[] }): string | null {
  if (opts.refreshing) return 'Проверяем изменения…';
  if (opts.invalidCards.length > 0) return `Проверьте сумму в карточке счёта «${opts.invalidCards[0]}»`;
  if (p.errors.total > 0) return 'Исправьте ошибки в файле и загрузите его снова';
  const account = firstAccountError(p);
  if (account) return account.message;
  if (p.counts.add === 0) return p.counts.duplicates > 0 ? 'Нечего импортировать: все строки — дубликаты' : 'Нечего импортировать';
  return p.canImport ? null : 'Импорт сейчас невозможен';
}

/** Живая область после проверки (§5.8): «Найдено ошибок: 23» или «Проверка завершена: ошибок нет, можно импортировать». */
export function checkStatus(p: ImportPreview): string {
  if (p.errors.total > 0) return `Найдено ошибок: ${formatCount(p.errors.total)}`;
  const reason = blockReason(p, { refreshing: false, invalidCards: [] });
  return reason ? `Проверка завершена. ${reason}` : 'Проверка завершена: ошибок нет, можно импортировать';
}

/** Группа «Будет создано» (§5.3 п. 4): заголовок со счётчиком, разделы (у категорий — «Доходы», «Расходы») и «и ещё N». */
export interface CreateGroup {
  key: 'categories' | 'counterparties' | 'projects' | 'tags';
  title: string;
  total: number;
  sections: { title: string | null; items: { name: string; note?: string }[] }[];
  more: number;
}

/** Непустые группы «Будет создано» в порядке спецификации. */
export function createGroups(p: ImportPreview): CreateGroup[] {
  const groups: CreateGroup[] = [];
  const c = p.create;
  if (c.categories.total > 0) {
    const name = (i: (typeof c.categories.items)[number]) => (i.parent ? `${i.parent} → ${i.name}` : i.name);
    const sections = [
      { title: 'Доходы', items: c.categories.items.filter((i) => i.kind === 'income').map((i) => ({ name: name(i) })) },
      { title: 'Расходы', items: c.categories.items.filter((i) => i.kind === 'expense').map((i) => ({ name: name(i) })) },
    ].filter((s) => s.items.length > 0);
    groups.push({ key: 'categories', title: 'Категории', total: c.categories.total, sections, more: c.categories.total - c.categories.items.length });
  }
  const plain = (key: 'counterparties' | 'projects' | 'tags', title: string) => {
    const g = c[key];
    if (g.total === 0) return;
    const items = g.items.map((i) => (i.type ? { name: i.name, note: COUNTERPARTY_TYPE_SINGULAR[i.type] } : { name: i.name }));
    groups.push({ key, title, total: g.total, sections: [{ title: null, items }], more: g.total - g.items.length });
  };
  plain('counterparties', 'Контрагенты');
  plain('projects', 'Проекты');
  plain('tags', 'Теги');
  return groups;
}

/** «+10 149 813 ₸», «\u22122 500 ₸»: движение счёта со знаком. */
export function signedMoney(minor: number, currency: string): string {
  return `${minor > 0 ? '+' : ''}${formatMoney(minor, currency, MONEY_SCREEN)}`;
}

const balanceText = (minor: number, currency: string) => formatMoney(minor, currency, MONEY_SCREEN_BEFORE);

/**
 * Вычисленное значение под полем суммы нового счёта (§5.4): «Текущий остаток» B — «Стартовый баланс: B \u2212 движение»;
 * «Стартовый баланс» S — «Остаток после импорта: S + движение»; пусто — «Остаток после импорта: движение».
 */
export function newAccountHint(balance: { mode: 'current' | 'start'; amount: number } | null, movement: number, currency: string): string {
  if (balance === null) return `Остаток после импорта: ${balanceText(movement, currency)}`;
  if (balance.mode === 'current') return `Стартовый баланс: ${balanceText(balance.amount - movement, currency)}`;
  return `Остаток после импорта: ${balanceText(balance.amount + movement, currency)}`;
}

/** Подсказка поля «Остаток после импорта» существующего счёта: пусто — каким станет остаток без поля. */
export function existingAccountHint(target: number | null, balance: number, movement: number, currency: string): string {
  return target === null
    ? `Пусто — после импорта остаток ${balanceText(balance + movement, currency)}`
    : 'Стартовый баланс пересчитается так, чтобы после импорта остаток был этой суммой';
}

/** Черновик карточки счёта: поле «Счёт» и поля сумм — как их видит человек (текст ещё может быть неверным). */
export interface CardDraft {
  /** id счёта, NEW_ACCOUNT или null — не выбран (A1). */
  choice: number | null;
  name: string;
  currency: string;
  mode: 'current' | 'start';
  /** Сумма нового счёта (текст поля). */
  amount: string;
  /** «Остаток после импорта» существующего счёта (текст поля). */
  target: string;
}

/** Текст поля суммы из минимальных единиц: «1 500,50». */
const amountText = (minor: number, currency: string) => formatAmount(minor, isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2);

/** Черновик из сопоставления, которое прислал сервер (по умолчанию или из запроса). */
export function draftFromCard(card: ImportPreviewAccount, baseCurrency: string): CardDraft {
  const m = card.mapping;
  const blank: CardDraft = { choice: null, name: card.fileName, currency: baseCurrency, mode: 'current', amount: '', target: '' };
  if (!m) return blank;
  if (m.kind === 'existing') {
    const currency = card.currency ?? baseCurrency;
    return { ...blank, choice: m.accountId, target: m.targetBalance == null ? '' : amountText(m.targetBalance, currency) };
  }
  return {
    ...blank,
    choice: NEW_ACCOUNT,
    name: m.name,
    currency: m.currency,
    mode: m.balance?.mode ?? 'current',
    amount: m.balance ? amountText(m.balance.amount, m.currency) : '',
  };
}

/** Текст ошибки суммы, как в форме счёта. */
function amountError(currency: string): string {
  const minor = isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2;
  return minor > 0 ? `Введите сумму, например 1 500,${'5'.padEnd(minor, '0')}` : 'Введите сумму без дробной части, например 1 500';
}

/**
 * Сопоставление из черновика для запроса предпросмотра. Неверная сумма — error (запрос не уходит, кнопка недоступна);
 * счёт не выбран — mapping null (на сервер не отправляется: остаётся A1). accountCurrency — валюта выбранного существующего счёта.
 */
export function mappingFromDraft(key: string, d: CardDraft, accountCurrency: string | null): { mapping: AccountMapping | null; error: string | null } {
  if (d.choice === null) return { mapping: null, error: null };
  if (d.choice !== NEW_ACCOUNT) {
    const hasTarget = d.target.trim() !== '';
    // валюта счёта неизвестна — сумму не разобрать: ошибка, а не молчаливое допущение KZT
    if (hasTarget && accountCurrency === null) return { mapping: null, error: 'Не удалось определить валюту счёта' };
    const currency = accountCurrency ?? '';
    const target = hasTarget ? parseAmount(d.target, isKnownCurrency(currency) ? getCurrency(currency).minorUnits : 2) : null;
    if (target === null && hasTarget) return { mapping: null, error: amountError(currency) };
    return { mapping: { key, kind: 'existing', accountId: d.choice, targetBalance: target }, error: null };
  }
  const amount = d.amount.trim() === '' ? null : parseAmount(d.amount, isKnownCurrency(d.currency) ? getCurrency(d.currency).minorUnits : 2);
  if (amount === null && d.amount.trim() !== '') return { mapping: null, error: amountError(d.currency) };
  return { mapping: { key, kind: 'new', name: d.name, currency: d.currency, balance: amount === null ? null : { mode: d.mode, amount } }, error: null };
}

/**
 * Сопоставления для запроса (§5.4): выбор человека по ключу счёта (он переживает «Выбрать другой файл») или то, что
 * показал сервер. Только счета этого файла; невыбранные (A1) не отправляются.
 */
export function requestMappings(p: ImportPreview, choices: ReadonlyMap<string, AccountMapping>): AccountMapping[] {
  return p.accounts.flatMap((card) => {
    const m = choices.get(card.key) ?? card.mapping;
    return m ? [m] : [];
  });
}

/** Равенство сопоставлений по полям: не зависит от порядка ключей; null и отсутствующее поле равны. */
export function sameMapping(a: AccountMapping, b: AccountMapping | null): boolean {
  if (b === null || a.key !== b.key || a.kind !== b.kind) return false;
  if (a.kind === 'existing' && b.kind === 'existing') return a.accountId === b.accountId && (a.targetBalance ?? null) === (b.targetBalance ?? null);
  if (a.kind === 'new' && b.kind === 'new') {
    const x = a.balance ?? null;
    const y = b.balance ?? null;
    return a.name === b.name && a.currency === b.currency && (x === null ? y === null : y !== null && x.mode === y.mode && x.amount === y.amount);
  }
  return false;
}

/** В новом файле есть счета, выбранные человеком раньше иначе, чем по умолчанию: нужен пересчёт с этим выбором. */
export function needsRemembered(p: ImportPreview, choices: ReadonlyMap<string, AccountMapping>): boolean {
  return p.accounts.some((card) => {
    const m = choices.get(card.key);
    return m !== undefined && !sameMapping(m, card.mapping);
  });
}

/** Ненулевые виды созданного (или удалённого отменой): «2 счёта», «12 категорий», «25 контрагентов», «1 тег». */
export function createdParts(c: ImportCreatedCounts): string[] {
  return [
    c.accounts && `${formatCount(c.accounts)} ${pluralRu(c.accounts, 'счёт', 'счёта', 'счетов')}`,
    c.categories && `${formatCount(c.categories)} ${pluralRu(c.categories, 'категория', 'категории', 'категорий')}`,
    c.counterparties && `${formatCount(c.counterparties)} ${pluralRu(c.counterparties, 'контрагент', 'контрагента', 'контрагентов')}`,
    c.projects && `${formatCount(c.projects)} ${pluralRu(c.projects, 'проект', 'проекта', 'проектов')}`,
    c.tags && `${formatCount(c.tags)} ${pluralRu(c.tags, 'тег', 'тега', 'тегов')}`,
  ].filter((x): x is string => typeof x === 'string');
}

/** Итог записи (§5.6): «Добавлено 1 234 операции. Создано: 2 счёта, 12 категорий, 25 контрагентов, 1 тег. Пропущено дубликатов: 0». */
export function doneText(r: ImportCommitResult): string {
  const parts = createdParts(r.import.created);
  const created = parts.length > 0 ? ` Создано: ${parts.join(', ')}.` : '';
  return `Добавлено ${operationsText(r.counts.added)}.${created} Пропущено дубликатов: ${formatCount(r.counts.duplicates)}`;
}

/** Свежий предпросмотр в ответе 409 и 422 (details.preview). */
export function isImportPreview(x: unknown): x is ImportPreview {
  const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const num = (v: unknown) => typeof v === 'number';
  if (!obj(x)) return false;
  const { file, counts, period, errors, create, duplicates } = x;
  return (
    typeof x.token === 'string' &&
    typeof x.revision === 'string' &&
    typeof x.canImport === 'boolean' &&
    obj(file) &&
    num(file.rows) &&
    obj(counts) &&
    (['income', 'expense', 'transfer', 'add', 'duplicates'] as const).every((k) => num(counts[k])) &&
    (period === null || (obj(period) && typeof period.from === 'string' && typeof period.to === 'string')) &&
    Array.isArray(x.accounts) &&
    x.accounts.every(
      (a) => obj(a) && typeof a['key'] === 'string' && typeof a['fileName'] === 'string' && Array.isArray(a['errors']) && (a['mapping'] === null || obj(a['mapping'])),
    ) &&
    obj(errors) &&
    num(errors.total) &&
    Array.isArray(errors.byCode) &&
    Array.isArray(x.warnings) &&
    obj(duplicates) &&
    num(duplicates.count) &&
    Array.isArray(duplicates.rows) &&
    obj(create) &&
    (['categories', 'counterparties', 'projects', 'tags'] as const).every((k) => {
      const g = create[k];
      return obj(g) && num(g.total) && Array.isArray(g.items);
    })
  );
}

// ——— запросы ———

/**
 * Загрузка файла (§6.2): локально — байты телом application/octet-stream, имя — в X-File-Name (как у вложений); на Vercel —
 * сначала в Blob, проверка — по ключу файла (план 2026-10-20-vercel-postgres, Р11, Р12).
 */
export async function uploadImport(companyId: number, file: File): Promise<ImportPreview> {
  const path = `/companies/${companyId}/imports/upload`;
  if ((await uploadMode()) === 'blob') {
    const blobKey = await uploadToBlob('import', file);
    return api<ImportPreview>(path, { method: 'POST', body: { blobKey, fileName: file.name } });
  }
  return api<ImportPreview>(path, { method: 'POST', file: { data: file, name: file.name } });
}

export function previewImport(companyId: number, token: string, accounts: AccountMapping[]): Promise<ImportPreview> {
  return api<ImportPreview>(`/companies/${companyId}/imports/preview`, { method: 'POST', body: { token, accounts } });
}

export function commitImport(companyId: number, p: ImportPreview, accounts: AccountMapping[]): Promise<ImportCommitResult> {
  return api<ImportCommitResult>(`/companies/${companyId}/imports`, { method: 'POST', body: { token: p.token, accounts, revision: p.revision } });
}

/** Ссылка «Скачать шаблон» (§5.2): GET по сессии. */
export const IMPORT_TEMPLATE_HREF = '/api/v1/imports/template.xlsx';

/** После записи (§5.6): журнал, счета и балансы, компании, справочники и история. */
export async function invalidateAfterImport(companyId: number): Promise<void> {
  await Promise.all([
    invalidateOperations(companyId),
    ...['categories', 'counterparties', 'projects', 'tags', 'audit', 'imports'].map((k) => queryClient.invalidateQueries({ queryKey: [k, companyId] })),
  ]);
}
