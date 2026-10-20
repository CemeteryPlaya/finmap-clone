import { afterEach, describe, expect, it, vi } from 'vitest';
import { backupTexts, downloadBackupNow } from '../../src/client/lib/backup';

/** Экран «Резервное копирование» на диске и на Vercel (план 2026-10-20-vercel-postgres, задача 16). */

afterEach(() => vi.unstubAllGlobals());

describe('backupTexts', () => {
  it('на диске — как раньше: архив с вложениями, 04:00 и при запуске, папка BACKUP_COPY_DIR', () => {
    expect(backupTexts({ storage: 'disk', keep: 14, copyDir: null })).toEqual({
      contents: 'Копия общая для всех компаний: архив содержит базу и вложения всех компаний.',
      schedule: 'Ежедневно в 04:00 и при запуске, если последней копии больше суток.',
      placeLabel: 'Папка для копий (BACKUP_COPY_DIR)',
      place: 'Не задана — копии хранятся только в data/backups',
    });
    expect(backupTexts({ storage: 'disk', keep: 14, copyDir: 'D:\\Копии' }).place).toBe('D:\\Копии');
  });

  it('на Vercel — выгрузка базы в хранилище, задание около 04:00, сколько копий хранится', () => {
    expect(backupTexts({ storage: 'blob', keep: 14, copyDir: null })).toEqual({
      contents: 'Копия общая для всех компаний: выгрузка базы всех компаний; вложения хранятся отдельно в Vercel Blob.',
      schedule: 'Ежедневно около 04:00 (задание Vercel); хранятся 14 последних копий.',
      placeLabel: 'Где хранятся',
      place: 'Vercel Blob, папка backups/',
    });
  });
});

describe('downloadBackupNow', () => {
  it('на Vercel — переход по ссылке на свежую выгрузку; локально — архив из ответа', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
      calls.push(`${url} ${new Headers(init.headers).get('x-requested-with')}`);
      return url === '/api/v1/backup/download'
        ? new Response(JSON.stringify({ url: 'https://store.private.blob.vercel-storage.com/exports/u/backup.json.gz?presign=1', fileName: 'backup.json.gz' }), {
            headers: { 'content-type': 'application/json' },
          })
        : new Response('{}', { status: 404 });
    });
    const go = vi.fn();
    const save = vi.fn();
    await downloadBackupNow('blob', { go, save });
    expect(go).toHaveBeenCalledWith('https://store.private.blob.vercel-storage.com/exports/u/backup.json.gz?presign=1');
    expect(save).not.toHaveBeenCalled();
    expect(calls).toEqual(['/api/v1/backup/download fetch']);

    vi.stubGlobal('fetch', async () => new Response(new Uint8Array([80, 75]), { headers: { 'content-disposition': 'attachment; filename="backup-1.zip"' } }));
    await downloadBackupNow('disk', { go, save });
    expect(save).toHaveBeenCalledWith(expect.any(Blob), 'backup-1.zip');
    expect(go).toHaveBeenCalledTimes(1);
  });
});
