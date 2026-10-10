import { useMutation } from '@tanstack/react-query';
import { useOutletContext } from 'react-router';
import { formatDateTime } from '../../../shared/dates';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import { downloadFile, saveBlob, type ApiError } from '../../lib/api';
import { formatBytes } from '../../lib/audit-format';
import { queryClient, useMeta } from '../../lib/query';
import { useBackupStatus } from '../../lib/queries';
import type { CompanyOutletContext } from '../CompanyLayout';
import { SHARED_NOTE } from '../../lib/settings-sections';

export function BackupSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const status = useBackupStatus();
  const meta = useMeta();
  const download = useMutation<void, ApiError>({
    mutationFn: async () => {
      const { blob, filename } = await downloadFile('/backup/download');
      saveBlob(blob, filename);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['backup-status'] }),
  });

  if (!status.data || !meta.data) return <Pending queries={[status, meta]} />;
  const s = status.data;

  return (
    <section>
      <StaleNotice queries={[status]} />
      <h1 className="mb-2 text-2xl font-bold">Резервное копирование</h1>
      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Архив содержит базу и вложения всех компаний. Автокопия делается каждый день в 04:00 и при запуске, если последней больше суток.
      </p>
      <dl className="mb-6 grid max-w-2xl gap-x-6 gap-y-2 text-sm md:grid-cols-[16rem_1fr]">
        {/* последний архив любого вида: ежедневный, стартовый, перед миграцией */}
        <dt className="text-muted">Последняя копия</dt>
        <dd>{s.last ? `${formatDateTime(s.last.createdAt, meta.data.timezone)} · ${formatBytes(s.last.size)}` : 'Ещё не было'}</dd>
        <dt className="text-muted">Папка для копий (BACKUP_COPY_DIR)</dt>
        <dd className="break-all">{s.copyDir ?? 'Не задана — копии хранятся только в data/backups'}</dd>
      </dl>
      {s.lastCopyError && (
        <p role="alert" className={alertClass}>
          Не удалось скопировать архив в BACKUP_COPY_DIR: {s.lastCopyError}
        </p>
      )}
      {download.error && (
        <p role="alert" className={alertClass}>
          {download.error.message}
        </p>
      )}
      <button type="button" onClick={() => download.mutate()} disabled={download.isPending} className={btnPrimary}>
        {download.isPending ? 'Готовим архив…' : 'Скачать сейчас'}
      </button>
    </section>
  );
}
