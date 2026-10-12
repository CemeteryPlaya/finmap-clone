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
}
