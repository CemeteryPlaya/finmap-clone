/**
 * Хранилище файлов (план 2026-10-20-vercel-postgres, Р10): вложения, файлы импорта, выгрузки и бэкапы на Vercel.
 * Ключ — относительный путь через «/» (`uploads/attachment/<uuid>.png`, `backups/2026-10-20.json.gz`).
 * Локально — папка на диске (createLocalStore), на Vercel — приватное хранилище Vercel Blob (createBlobStore).
 */
export interface StoredFile {
  key: string;
  size: number;
  uploadedAt: Date;
}

export interface FileStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Содержимое файла; null — файла нет. */
  get(key: string): Promise<Buffer | null>;
  /** Удаление; файла нет — не ошибка. */
  remove(key: string): Promise<void>;
  /** Файлы с ключом, начинающимся с prefix, по возрастанию ключа. */
  list(prefix: string): Promise<StoredFile[]>;
  /** Короткоживущая ссылка на скачивание; null — хранилище ссылок не даёт (локально файл отдаёт приложение). */
  downloadUrl(key: string): Promise<string | null>;
}

/** Ключ без выхода из хранилища: относительный, без «..», «.» и пустых частей. */
export function assertKey(key: string): void {
  const parts = key.split('/');
  if (key === '' || key.includes('\\') || parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`Недопустимый ключ файла: ${key}`);
  }
}
