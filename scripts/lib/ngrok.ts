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

/**
 * Ошибки, которые повтор не исправит: неверный authtoken (ERR_NGROK_105) и ошибки домена
 * (ERR_NGROK_3xx с упоминанием домена — не зарезервирован, неверный и т. п.).
 * Всё остальное (сеть, неизвестное) — повторяем.
 */
export function isFatalNgrokError(err: unknown): boolean {
  const code = ngrokCode(err);
  if (code === null) return false;
  if (code === 105) return true;
  return code >= 300 && code < 400 && /domain/i.test(errorText(err));
}

/**
 * Подключение с повторами: пауза 1→2→4…60 с между попытками.
 * Фатальную ошибку пробрасывает; при остановке (isStopped) возвращает null.
 */
export async function connectWithRetry<T>(o: {
  connect: () => Promise<T>;
  isFatal: (err: unknown) => boolean;
  isStopped: () => boolean;
  sleep: (ms: number) => Promise<void>;
  onRetry: (err: unknown, delayMs: number) => void;
}): Promise<T | null> {
  let delay = 1000;
  for (;;) {
    if (o.isStopped()) return null;
    try {
      return await o.connect();
    } catch (e) {
      if (o.isFatal(e)) throw e;
      if (o.isStopped()) return null;
      o.onRetry(e, delay);
      await o.sleep(delay);
      delay = Math.min(delay * 2, 60_000);
    }
  }
}
