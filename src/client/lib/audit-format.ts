export const ENTITY_LABELS: Record<string, string> = {
  company: 'Компания',
  project: 'Проект',
  account: 'Счёт',
  category: 'Статья',
  counterparty: 'Контрагент',
  tag: 'Тег',
  split_preset: 'Шаблон разделения',
  user: 'Пользователь',
  operation: 'Операция',
  rate: 'Курс',
  fixed_rate: 'Фиксированный курс',
  attachment: 'Вложение',
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

/** Строки «поле: было → стало» для diff вида { before, after }; null — показать JSON как есть. */
export function diffRows(diff: Record<string, unknown> | null): DiffRow[] | null {
  if (!diff) return null;
  const { before, after } = diff;
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return null;
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return fields.map((field) => ({ field, before: show(b[field]), after: show(a[field]) }));
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
