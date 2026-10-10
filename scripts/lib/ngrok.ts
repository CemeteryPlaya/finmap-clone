/** Заменяет каждое вхождение секрета на *** (библиотека ngrok повторяет authtoken в тексте ошибки). */
export function maskSecret(text: string, secret: string | null | undefined): string {
  if (!secret) return text;
  return text.split(secret).join('***');
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function ngrokCode(err: unknown): number | null {
  const fromField = (err as { errorCode?: unknown } | null)?.errorCode;
  const source = typeof fromField === 'string' ? fromField : errorText(err);
  const m = /ERR_NGROK_(\d+)/.exec(source);
  return m ? Number(m[1]) : null;
}

/** Коды, которые проходят сами: прошлая сессия этого ПК ещё не закрыта на стороне ngrok (сразу после перезапуска). */
const TRANSIENT_CODES = new Set([108, 324, 334]);
/** Сколько попыток даём таким кодам (паузы 1+2+4+8+16+32+60 с — около двух минут). */
export const TRANSIENT_ATTEMPTS = 8;

/**
 * Повтор не исправит ответ ngrok с кодом ошибки: authtoken (105, 4018), домен и тариф (3xx).
 * Исключение — коды занятой сессии: им даём TRANSIENT_ATTEMPTS попыток. Ошибки без кода (сеть) — повторяем всегда.
 * attempt — номер неудачной попытки, начиная с 1.
 */
export function isFatalNgrokError(err: unknown, attempt = 1): boolean {
  const code = ngrokCode(err);
  if (code === null) return false;
  if (TRANSIENT_CODES.has(code)) return attempt >= TRANSIENT_ATTEMPTS;
  return true;
}

/**
 * Подключение с повторами: пауза 1→2→4…60 с между попытками.
 * Фатальную ошибку пробрасывает; при остановке (isStopped) возвращает null.
 */
export async function connectWithRetry<T>(o: {
  connect: () => Promise<T>;
  isFatal: (err: unknown, attempt: number) => boolean;
  isStopped: () => boolean;
  sleep: (ms: number) => Promise<void>;
  onRetry: (err: unknown, delayMs: number) => void;
}): Promise<T | null> {
  let delay = 1000;
  let attempt = 0;
  for (;;) {
    if (o.isStopped()) return null;
    try {
      return await o.connect();
    } catch (e) {
      attempt++;
      if (o.isFatal(e, attempt)) throw e;
      if (o.isStopped()) return null;
      o.onRetry(e, delay);
      await o.sleep(delay);
      delay = Math.min(delay * 2, 60_000);
    }
  }
}
