export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
    /** Данные для действия в интерфейсе: у RATE_UNAVAILABLE — `currency` и `date`, у IMPORT_INVALID и IMPORT_CHANGED — `preview`. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  opts: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    /** Файл вместо JSON: байты телом `application/octet-stream`, имя — в `X-File-Name` (вложения, план 4b). */
    file?: { data: Blob; name: string };
  } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'fetch',
        ...(opts.file
          ? { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(opts.file.name) }
          : opts.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
      },
      body: opts.file ? opts.file.data : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Нет связи с сервером');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; fields?: Record<string, string>; details?: Record<string, unknown> };
  } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? 'Ошибка сервера', data?.error?.fields, data?.error?.details);
  }
  return data as T;
}

/** Скачивание файла через fetch: простая ссылка не годится, маршрут требует X-Requested-With (защита от CSRF). */
export async function downloadFile(path: string): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch' } });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Нет связи с сервером');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, data?.error?.code ?? 'INTERNAL', data?.error?.message ?? 'Ошибка сервера');
  }
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'download';
  return { blob: await res.blob(), filename };
}

/** Отдаёт Blob браузеру как скачиваемый файл. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
