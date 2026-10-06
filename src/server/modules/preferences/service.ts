import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { userPreferences } from '../../db/schema';
import { AppError } from '../../errors';

export const PREF_KEY_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
export const PREF_VALUE_MAX = 8 * 1024;
export const PREF_KEYS_MAX = 50;

/** Настройки интерфейса пользователя (§4.2): видимые колонки, свёрнутая панель, последняя компания. Историю не пишут. */
export interface PreferencesService {
  all(userId: number): Record<string, unknown>;
  set(userId: number, key: string, value: unknown): void;
}

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);

export function createPreferencesService(db: Db, now: () => Date = () => new Date()): PreferencesService {
  return {
    all(userId) {
      const rows = db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).all();
      return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
    },

    set(userId, key, value) {
      if (!PREF_KEY_RE.test(key)) throw invalid({ key: 'Недопустимый ключ' });
      const json = JSON.stringify(value);
      if (Buffer.byteLength(json, 'utf8') > PREF_VALUE_MAX) throw invalid({ value: 'Слишком большое значение' }); // байты, не символы
      db.transaction((tx) => {
        const exists = tx
          .select({ id: userPreferences.id })
          .from(userPreferences)
          .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key)))
          .get();
        if (!exists) {
          const n = tx.select({ n: count() }).from(userPreferences).where(eq(userPreferences.userId, userId)).get()?.n ?? 0;
          if (n >= PREF_KEYS_MAX) throw invalid({ key: 'Слишком много настроек' });
        }
        tx.insert(userPreferences)
          .values({ userId, key, value: json, updatedAt: now().toISOString() })
          .onConflictDoUpdate({ target: [userPreferences.userId, userPreferences.key], set: { value: json, updatedAt: now().toISOString() } })
          .run();
      });
    },
  };
}
