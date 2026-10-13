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
