import type { ImportUndoResult } from '../../shared/schemas/imports';
import { undoResultText } from './import-history';
import { createdParts, formatCount, operationsText } from './import-panel';

export const ENTITY_LABELS: Record<string, string> = {
  company: 'Компания',
  project: 'Проект',
  account: 'Счёт',
  category: 'Категория',
  counterparty: 'Контрагент',
  tag: 'Тег',
  split_preset: 'Шаблон разделения',
  user: 'Пользователь',
  operation: 'Операция',
  rate: 'Курс',
  fixed_rate: 'Фиксированный курс',
  attachment: 'Вложение',
  import: 'Импорт',
};

export const ACTION_LABELS: Record<string, string> = {
  create: 'Создание',
  update: 'Изменение',
  delete: 'Удаление',
  restore: 'Восстановление',
  archive: 'В архив',
  unarchive: 'Из архива',
  reorder: 'Порядок',
  login: 'Вход',
  logout: 'Выход',
  password_change: 'Смена пароля',
};

/** Сущности ленты компании (для фильтра). */
export const COMPANY_ENTITIES = [
  'company',
  'project',
  'account',
  'category',
  'counterparty',
  'tag',
  'split_preset',
  'operation',
  'fixed_rate',
  'attachment',
  'import',
] as const;

/** Сущности общей ленты экземпляра (записи без компании): пользователи и ручные курсы. */
export const SYSTEM_ENTITIES = ['user', 'rate'] as const;

export interface DiffRow {
  field: string;
  before: string;
  after: string;
}

function show(v: unknown): string {
  if (v === undefined) return '—';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Типы операции по-русски — для «Тип: Расход → Перевод» (§10.1 этапа 1.5). */
export const OPERATION_TYPE_LABELS: Record<string, string> = { income: 'Доход', expense: 'Расход', transfer: 'Перевод' };

/**
 * Строки «поле: было → стало» для diff вида { before, after }; null — показать JSON как есть. У операции (`entity`)
 * тип показывается по-русски — «Расход → Перевод» (§10.1 этапа 1.5); у других сущностей поле type — как есть.
 */
export function diffRows(diff: Record<string, unknown> | null, entity?: string): DiffRow[] | null {
  if (!diff) return null;
  const { before, after } = diff;
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return null;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const value = (field: string, v: unknown) => (entity === 'operation' && field === 'type' && typeof v === 'string' && OPERATION_TYPE_LABELS[v]) || show(v);
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return fields.map((field) => ({ field, before: value(field, b[field]), after: value(field, a[field]) }));
}

/** Размер файла: «500 Б», «1,5 КБ», «1 МБ». */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1).replace('.', ',').replace(/,0$/, '')} ${units[i]}`;
}

/**
 * «Подробности» записи на полной странице «История действий». Для панели истории (§3.4 этапа 1.5) сервер пишет
 * в удаление и восстановление операции тип, сумму, счёт и дату: счёт по id здесь не нужен, а у восстановления
 * подробностей нет, как раньше. Тип в записи правки странице не мешает: таблица «Было / Стало» строится по before/after.
 */
export function pageDiff(e: { entity: string; action: string; diff: Record<string, unknown> | null }): Record<string, unknown> | null {
  if (e.entity !== 'operation' || e.diff === null) return e.diff;
  if (e.action === 'restore') return null;
  if (e.action === 'delete') {
    const { accountId: _accountId, ...rest } = e.diff;
    return rest;
  }
  return e.diff;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCounts = <K extends string>(v: unknown, keys: readonly K[]): v is Record<K, number> => isObj(v) && keys.every((k) => typeof v[k] === 'number');
const COUNT_KEYS = ['rows', 'income', 'expense', 'transfer', 'added', 'duplicates', 'skippedFuture'] as const;
const CREATED_KEYS = ['accounts', 'categories', 'counterparties', 'projects', 'tags'] as const;
const KEPT_ENTITIES: readonly unknown[] = ['account', 'category', 'counterparty', 'project', 'tag'];
const KEPT_FIELDS: readonly unknown[] = ['startingBalance', 'openedAt'];
const KEPT_REASONS: readonly unknown[] = ['changed', 'operations', 'archived', 'created', 'unverified'];
/** Элемент kept.names: { entity, name }. */
const isKeptName = (v: unknown) => isObj(v) && KEPT_ENTITIES.includes(v.entity) && typeof v.name === 'string';
/** Элемент kept.accounts: { accountId, name, field, reason }. */
const isKeptAccount = (v: unknown) =>
  isObj(v) && typeof v.accountId === 'number' && typeof v.name === 'string' && KEPT_FIELDS.includes(v.field) && KEPT_REASONS.includes(v.reason);

/** Что изменилось, кроме сущности и номера: у импорта — имя файла («Импорт №5 · выгрузка.xlsx», §6.5 спецификации импорта). */
export function auditSubject(e: { entity: string; diff: Record<string, unknown> | null }): string | null {
  return e.entity === 'import' && typeof e.diff?.fileName === 'string' ? e.diff.fileName : null;
}

/**
 * «Подробности» записи импорта на странице «История действий» (§6.5 спецификации импорта): у импорта — числа строк,
 * добавленного, пропущенного и созданного, у отмены — её итог. null — запись не импорта или неизвестного вида
 * (показывается как есть).
 */
export function importDetails(e: { entity: string; action: string; diff: Record<string, unknown> | null }): { label: string; value: string }[] | null {
  if (e.entity !== 'import' || !e.diff) return null;
  const d = e.diff;
  if (e.action === 'create' && isCounts(d.counts, COUNT_KEYS) && isCounts(d.created, CREATED_KEYS)) {
    const c = d.counts;
    const created = createdParts(d.created);
    return [
      { label: 'Строк в файле', value: formatCount(c.rows) },
      { label: 'Добавлено', value: `${operationsText(c.added)} (доходов ${formatCount(c.income)}, расходов ${formatCount(c.expense)}, переводов ${formatCount(c.transfer)})` },
      { label: 'Пропущено дубликатов', value: formatCount(c.duplicates) },
      { label: 'Пропущено плановых', value: formatCount(c.skippedFuture) },
      { label: 'Создано', value: created.length > 0 ? created.join(', ') : 'ничего' },
    ];
  }
  if (e.action === 'delete' && isObj(d.deleted) && isObj(d.kept)) {
    const kept = d.kept;
    if (
      isCounts(d.deleted, ['operations', ...CREATED_KEYS] as const) &&
      typeof kept.operations === 'number' &&
      isCounts(kept.created, CREATED_KEYS) &&
      Array.isArray(kept.names) &&
      kept.names.every(isKeptName) &&
      Array.isArray(kept.accounts) &&
      kept.accounts.every(isKeptAccount)
    ) {
      return [{ label: 'Итог', value: undoResultText({ deleted: d.deleted, kept: kept as unknown as ImportUndoResult['kept'] }) }];
    }
  }
  return null;
}
