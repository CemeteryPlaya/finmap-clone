import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { first } from '../../db/raw';
import { withTx } from '../../db/tx';
import { userPreferences } from '../../db/schema';
import { AppError } from '../../errors';

export const PREF_KEY_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
export const PREF_VALUE_MAX = 8 * 1024;
export const PREF_KEYS_MAX = 50;

/** Настройки интерфейса пользователя (§4.2): видимые колонки, свёрнутая панель, последняя компания. Историю не пишут. */
export interface PreferencesService {
  all(userId: number): Promise<Record<string, unknown>>;
  set(userId: number, key: string, value: unknown): Promise<void>;
}

const invalid = (fields: Record<string, string>) => new AppError(400, 'VALIDATION', 'Проверьте заполнение полей', fields);

export function createPreferencesService(db: Db, now: () => Date = () => new Date()): PreferencesService {
  return {
    async all(userId) {
      const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
      return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
    },

    async set(userId, key, value) {
      if (!PREF_KEY_RE.test(key)) throw invalid({ key: 'Недопустимый ключ' });
      const json = JSON.stringify(value);
      if (Buffer.byteLength(json, 'utf8') > PREF_VALUE_MAX) throw invalid({ value: 'Слишком большое значение' }); // байты, не символы
      await withTx(db, async (tx) => {
        const exists = await first(
          tx
            .select({ id: userPreferences.id })
            .from(userPreferences)
            .where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, key))),
        );
        if (!exists) {
          const n = (await first(tx.select({ n: count() }).from(userPreferences).where(eq(userPreferences.userId, userId))))?.n ?? 0;
          if (n >= PREF_KEYS_MAX) throw invalid({ key: 'Слишком много настроек' });
        }
        await tx
          .insert(userPreferences)
          .values({ userId, key, value: json, updatedAt: now().toISOString() })
          .onConflictDoUpdate({ target: [userPreferences.userId, userPreferences.key], set: { value: json, updatedAt: now().toISOString() } });
      });
    },
  };
}
