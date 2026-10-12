import crypto from 'node:crypto';
import type { ParsedFile } from './parse-row';

/**
 * Кэш проверки (§6.3 спецификации импорта): разобранный файл в памяти процесса под случайным токеном (128 бит),
 * привязанным к компании и пользователю. Исходные байты не хранятся и на диск не пишутся; разобранный файл хранится
 * отдельной копией (structuredClone), не держащей распакованный текст листа.
 */
export interface CachedImport {
  companyId: number;
  userId: number;
  file: { name: string; size: number; sha256: string };
  parsed: ParsedFile;
}

export interface ImportCache {
  /** Новый токен. Прежний файл того же пользователя в той же компании удаляется; сверх предела вытесняется самый давний. */
  put(item: CachedImport): string;
  /** Файл по токену своей компании и своего пользователя; иначе или после срока — null. Обращение продлевает срок. */
  get(token: string, companyId: number, userId: number): CachedImport | null;
  remove(token: string): void;
  size(): number;
}

/** Срок — 30 минут с последнего обращения; не больше 3 файлов на сервер. */
export const IMPORT_CACHE_TTL_MS = 30 * 60_000;
export const IMPORT_CACHE_MAX = 3;
/** Примерный объём всех файлов кэша в памяти: сверх него вытесняются самые давние (но последний загруженный остаётся). */
export const IMPORT_CACHE_MAX_BYTES = 150 * 1024 * 1024;

/** Постоянная часть строки импорта: объект, числа, короткие строки дат и минуты. */
const ROW_BYTES = 400;
/** Постоянная часть замечания: объект, код, номер строки. */
const ISSUE_BYTES = 64;

/** Примерный объём разобранного файла в памяти: постоянная часть строк и замечаний плюс тексты (UTF-16 — 2 байта на знак). */
export function cachedImportWeight(item: CachedImport): number {
  const { rows, issues, future } = item.parsed;
  let chars = item.file.name.length + item.file.sha256.length;
  for (const r of rows) {
    chars += r.amount.length + r.account.key.length + r.account.name.length;
    if (r.toAccount) chars += r.toAccount.key.length + r.toAccount.name.length;
    chars += (r.category?.length ?? 0) + (r.subcategory?.length ?? 0) + (r.counterparty?.length ?? 0) + (r.project?.length ?? 0) + (r.comment?.length ?? 0);
    for (const t of r.tags) chars += t.length;
  }
  for (const i of issues) chars += i.message.length;
  return rows.length * ROW_BYTES + issues.length * ISSUE_BYTES + future.length * 8 + chars * 2;
}

export function createImportCache(opts: { now?: () => number; ttlMs?: number; max?: number; maxBytes?: number } = {}): ImportCache {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? IMPORT_CACHE_TTL_MS;
  const max = opts.max ?? IMPORT_CACHE_MAX;
  const maxBytes = opts.maxBytes ?? IMPORT_CACHE_MAX_BYTES;
  const entries = new Map<string, CachedImport & { lastUsed: number; weight: number }>();
  let total = 0;

  const drop = (token: string) => {
    const e = entries.get(token);
    if (!e) return;
    total -= e.weight;
    entries.delete(token);
  };

  const sweep = () => {
    const t = now();
    for (const [token, e] of entries) if (t - e.lastUsed > ttl) drop(token);
  };

  return {
    put(item) {
      sweep();
      for (const [token, e] of entries) if (e.companyId === item.companyId && e.userId === item.userId) drop(token);
      const weight = cachedImportWeight(item);
      // не больше max файлов и (кроме нового) не больше maxBytes: вытесняется самый давний
      while (entries.size > 0 && (entries.size >= max || total + weight > maxBytes)) {
        let oldest: string | null = null;
        for (const [token, e] of entries) if (oldest === null || e.lastUsed < entries.get(oldest)!.lastUsed) oldest = token;
        drop(oldest!);
      }
      const token = crypto.randomBytes(16).toString('hex');
      // отдельная копия: строки разбора — срезы распакованного листа, общих строк и текста CSV и держали бы их
      // в памяти целиком (десятки МБ на файл), невидимо для веса выше; у копии строки свои (§6.3, решение 22)
      entries.set(token, { ...item, parsed: structuredClone(item.parsed), lastUsed: now(), weight });
      total += weight;
      return token;
    },
    get(token, companyId, userId) {
      sweep();
      const e = entries.get(token);
      if (!e || e.companyId !== companyId || e.userId !== userId) return null;
      e.lastUsed = now();
      return { companyId: e.companyId, userId: e.userId, file: e.file, parsed: e.parsed };
    },
    remove(token) {
      drop(token);
    },
    size: () => entries.size,
  };
}
