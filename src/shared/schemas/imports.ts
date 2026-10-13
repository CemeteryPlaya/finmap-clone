import { z } from 'zod';
import type { CategoryKind, CounterpartyType } from '../system-categories';

/** Сумма в минимальных единицах: целое, безопасное (знак любой — остаток бывает отрицательным). */
const minor = z.number().refine(Number.isSafeInteger, 'Сумма — целое число минимальных единиц');
/** Ключ счёта из файла (nameKey названия). */
const key = z.string().min(1).max(40_000);

/**
 * Сопоставление счёта из файла (§6.2 спецификации импорта): существующий счёт (необязательный «Остаток после импорта»)
 * или новый (название, валюта, «Текущий остаток» или «Стартовый баланс»). Суммы — в минимальных единицах валюты счёта.
 */
export const accountMappingSchema = z.discriminatedUnion('kind', [
  z.object({
    key,
    kind: z.literal('existing'),
    accountId: z.number().int().positive(),
    targetBalance: minor.nullable().optional(),
  }),
  z.object({
    key,
    kind: z.literal('new'),
    name: z.string().max(1000),
    currency: z.string().min(1).max(10),
    balance: z.object({ mode: z.enum(['current', 'start']), amount: minor }).nullable(),
  }),
]);
export type AccountMapping = z.infer<typeof accountMappingSchema>;

/** Не больше разных счетов в файле (иначе F9) — и сопоставлений в запросе. */
export const IMPORT_ACCOUNTS_MAX = 1000;

/** Тело POST …/imports/preview и POST …/imports: токен проверки и сопоставление счетов. */
export const importRequestSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{32}$/, 'Проверка устарела — загрузите файл заново'),
  accounts: z.array(accountMappingSchema).max(IMPORT_ACCOUNTS_MAX, 'Слишком много счетов').default([]),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

/**
 * Тело POST …/imports (§6.2): то же, что у предпросмотра, и версия проверки, которую видел человек. Свежая проверка
 * внутри транзакции записи с другой версией — 409 IMPORT_CHANGED (решение 4 плана И-2).
 */
export const importCommitSchema = importRequestSchema.extend({
  revision: z.string().regex(/^[0-9a-f]{16}$/, 'Проверка устарела — загрузите файл заново'),
});
export type ImportCommitRequest = z.infer<typeof importCommitSchema>;

/** Группа ошибок или предупреждений: код, текст, число строк и до 20 первых номеров. */
export interface ImportIssueGroup {
  code: string;
  message: string;
  count: number;
  rows: number[];
}

export interface ImportPreviewAccount {
  key: string;
  /** Название из файла. */
  fileName: string;
  /** Добавляемых строк этого счёта. */
  rows: number;
  /** Текущее сопоставление (по умолчанию или из запроса); null — подходит несколько счетов, выбор за человеком (A1). */
  mapping: AccountMapping | null;
  /** Валюта счёта; null — счёт не выбран или валюта неизвестна. */
  currency: string | null;
  /** Движение добавляемых строк в валюте счёта: поступления минус списания. */
  movement: number;
  /** Существующий счёт: текущий остаток, дата открытия и её перенос на первую операцию файла. */
  existing?: { balance: number; openedAt: string; newOpenedAt: string | null };
  /** «Есть счёт «…» в архиве»: с этим ключом есть архивный счёт. */
  archivedHint: boolean;
  errors: { code: string; message: string }[];
}

export interface ImportCreateItem {
  name: string;
  kind?: CategoryKind;
  /** Родитель подкатегории. */
  parent?: string;
  /** Тип нового контрагента. */
  type?: CounterpartyType;
  rows: number;
}

/** Ответ проверки (§6.3): списки урезаны — номера строк до 20, названия до 200. */
export interface ImportPreview {
  token: string;
  file: { name: string; size: number; rows: number };
  counts: { income: number; expense: number; transfer: number; add: number; duplicates: number; skippedFuture: number };
  /** Календарные даты добавляемых строк. */
  period: { from: string; to: string } | null;
  accounts: ImportPreviewAccount[];
  create: Record<'categories' | 'counterparties' | 'projects' | 'tags', { total: number; items: ImportCreateItem[] }>;
  errors: { total: number; byCode: ImportIssueGroup[] };
  warnings: ImportIssueGroup[];
  duplicates: { count: number; rows: number[] };
  canImport: boolean;
  /** Версия проверки (16 шестнадцатеричных знаков): меняется с любым изменением итога; её отправляет «Импортировать». */
  revision: string;
}

/** Счётчики импорта (imports.counts, §6.1). */
export interface ImportCounts {
  /** Непустых строк данных в файле. */
  rows: number;
  income: number;
  expense: number;
  transfer: number;
  /** Добавлено операций. */
  added: number;
  duplicates: number;
  skippedFuture: number;
}

/** Сколько создано импортом. */
export interface ImportCreatedCounts {
  accounts: number;
  categories: number;
  counterparties: number;
  projects: number;
  tags: number;
}

/** Запись импорта в ответе (§6.2). */
export interface ImportRecord {
  id: number;
  fileName: string;
  fileSize: number;
  status: 'done' | 'undone';
  createdAt: string;
  counts: ImportCounts;
  created: ImportCreatedCounts;
}

/** Ответ 201 POST …/imports. */
export interface ImportCommitResult {
  import: ImportRecord;
  counts: ImportCounts;
}

/** Запрос списка импортов (§6.2, §7.2): GET …/imports?limit=20&beforeId=. */
export const importListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1, 'От 1 до 100').max(100, 'От 1 до 100').default(20),
  beforeId: z.coerce.number().int().positive().optional(),
});
export type ImportListQuery = z.infer<typeof importListQuerySchema>;

/** Операции импорта, которые удалит отмена (§7.2): всего и изменённых после импорта. */
export interface ImportPending {
  /** Все операции импорта, в том числе мягко удалённые. */
  operations: number;
  /** Изменённые после импорта (§7.3): неудалённые, с version > 1 или с вложением. */
  edited: number;
}

/** Запись списка «Импорты» (§7.2): новые сверху. */
export interface ImportListItem {
  id: number;
  fileName: string;
  fileSize: number;
  status: 'done' | 'undone';
  createdAt: string;
  /** Кто импортировал; null — пользователь удалён. */
  userName: string | null;
  counts: ImportCounts;
  undoneAt: string | null;
  undoneByName: string | null;
  /** Только у status = 'done'. */
  pending: ImportPending | null;
}

/** Ответ GET …/imports: страница и id для «Показать ещё» (null — больше нет). */
export interface ImportListPage {
  items: ImportListItem[];
  nextBeforeId: number | null;
}

/**
 * Тело POST …/imports/:id/undo (§6.2, §7.3): удалять ли изменённые после импорта операции и сколько изменённых видел
 * человек в подтверждении (pending.edited). С includeEdited изменённых стало больше — 409 IMPORT_CHANGED (решение 4 плана И-3).
 */
export const importUndoSchema = z.object({
  includeEdited: z.boolean(),
  edited: z.number().int().min(0),
});
export type ImportUndoRequest = z.infer<typeof importUndoSchema>;

/** Справочник, который создал импорт. */
export type ImportCreatedEntity = 'account' | 'category' | 'counterparty' | 'project' | 'tag';

/**
 * Поле счёта в итоге отмены: поле существующего счёта, которое отмена не вернула (изменено после импорта, есть операции
 * раньше прежней даты, счёт в архиве), или стартовый баланс оставленного созданного импортом счёта: рассчитанный
 * импортом — обнулён (`created`), изменён после импорта — остался (`changed`), импорт записан до учёта рассчитанных
 * балансов — остался, проверить (`unverified`).
 */
export interface ImportKeptAccountField {
  accountId: number;
  name: string;
  field: 'startingBalance' | 'openedAt';
  reason: 'changed' | 'operations' | 'archived' | 'created' | 'unverified';
}

/** Итог отмены (§7.3): imports.undo_result и ответ отмены. */
export interface ImportUndoResult {
  deleted: { operations: number } & ImportCreatedCounts;
  kept: {
    /** Изменённые после импорта операции, которые остались (без «Удалить и изменённые»). */
    operations: number;
    /** Созданное импортом, которое используется и осталось, — по видам. */
    created: ImportCreatedCounts;
    /** Первые 20 названий оставленного созданного. */
    names: { entity: ImportCreatedEntity; name: string }[];
    /** Поля существующих счетов, которые остались как есть, и обнулённые стартовые балансы оставленных созданных счетов. */
    accounts: ImportKeptAccountField[];
  };
}

/** Ответ 200 POST …/imports/:id/undo: запись импорта после отмены и итог. */
export interface ImportUndoResponse {
  import: ImportListItem;
  result: ImportUndoResult;
}
