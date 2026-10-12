import crypto from 'node:crypto';
import type { ParsedFile } from './parse-row';

/**
 * Кэш проверки (§6.3 спецификации импорта): разобранный файл в памяти процесса под случайным токеном (128 бит),
 * привязанным к компании и пользователю. Исходные байты не хранятся и на диск не пишутся.
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

export function createImportCache(opts: { now?: () => number; ttlMs?: number; max?: number } = {}): ImportCache {
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? IMPORT_CACHE_TTL_MS;
  const max = opts.max ?? IMPORT_CACHE_MAX;
  const entries = new Map<string, CachedImport & { lastUsed: number }>();

  const sweep = () => {
    const t = now();
    for (const [token, e] of entries) if (t - e.lastUsed > ttl) entries.delete(token);
  };

  return {
    put(item) {
      sweep();
      for (const [token, e] of entries) if (e.companyId === item.companyId && e.userId === item.userId) entries.delete(token);
      while (entries.size >= max) {
        let oldest: string | null = null;
        for (const [token, e] of entries) if (oldest === null || e.lastUsed < entries.get(oldest)!.lastUsed) oldest = token;
        entries.delete(oldest!);
      }
      const token = crypto.randomBytes(16).toString('hex');
      entries.set(token, { ...item, lastUsed: now() });
      return token;
    },
    get(token, companyId, userId) {
      sweep();
      const e = entries.get(token);
      if (!e || e.companyId !== companyId || e.userId !== userId) return null;
      e.lastUsed = now();
      return e;
    },
    remove(token) {
      entries.delete(token);
    },
    size: () => entries.size,
  };
}
