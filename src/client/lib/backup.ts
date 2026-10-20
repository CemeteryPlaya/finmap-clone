import { api, downloadFile, saveBlob } from './api';

/** Где лежат копии (`/backup/status`): на диске (локально) или в Vercel Blob (план 2026-10-20-vercel-postgres, Р13). */
export type BackupStorage = 'disk' | 'blob';

/** Тексты экрана «Резервное копирование» по месту хранения копий. */
export function backupTexts(s: { storage: BackupStorage; keep: number; copyDir: string | null }) {
  if (s.storage === 'blob') {
    return {
      contents: 'Копия общая для всех компаний: выгрузка базы всех компаний; вложения хранятся отдельно в Vercel Blob.',
      schedule: `Ежедневно около 04:00 (задание Vercel); хранятся ${s.keep} последних копий.`,
      placeLabel: 'Где хранятся',
      place: 'Vercel Blob, папка backups/',
    };
  }
  return {
    contents: 'Копия общая для всех компаний: архив содержит базу и вложения всех компаний.',
    schedule: 'Ежедневно в 04:00 и при запуске, если последней копии больше суток.',
    placeLabel: 'Папка для копий (BACKUP_COPY_DIR)',
    place: s.copyDir ?? 'Не задана — копии хранятся только в data/backups',
  };
}

/**
 * «Скачать сейчас»: локально архив приходит в ответе; на Vercel сервер кладёт свежую выгрузку в хранилище (ответ функции
 * не больше 4,5 МБ) и отдаёт подписанную ссылку — браузер переходит по ней и сохраняет файл.
 */
export async function downloadBackupNow(
  storage: BackupStorage,
  io: { go: (url: string) => void; save: (blob: Blob, name: string) => void } = { go: (url) => window.location.assign(url), save: saveBlob },
): Promise<void> {
  if (storage === 'blob') {
    io.go((await api<{ url: string; fileName: string }>('/backup/download')).url);
    return;
  }
  const { blob, filename } = await downloadFile('/backup/download');
  io.save(blob, filename);
}
