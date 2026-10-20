import { useMutation } from '@tanstack/react-query';
import { useId } from 'react';
import { formatDateTime } from '../../../shared/dates';
import { Pending, StaleNotice } from '../../components/QueryState';
import { alertClass, btnPrimary } from '../../components/ui';
import type { ApiError } from '../../lib/api';
import { backupTexts, downloadBackupNow } from '../../lib/backup';
import { formatBytes } from '../../lib/audit-format';
import { queryClient, useMeta } from '../../lib/query';
import { useBackupStatus } from '../../lib/queries';
import { SHARED_NOTE } from '../../lib/settings-sections';

/**
 * «Резервное копирование» (§7.4 этапа 1.5): копия общая для всех компаний; карточка «Автоматическая копия» —
 * плашка «Включено», расписание, последняя копия, папка `BACKUP_COPY_DIR` и её ошибка, «Скачать сейчас».
 * Списка копий нет: нового серверного маршрута для него не делаем.
 */
export function BackupSettings() {
  const status = useBackupStatus();
  const meta = useMeta();
  const titleId = useId();
  const download = useMutation<void, ApiError>({
    mutationFn: () => downloadBackupNow(status.data?.storage ?? 'disk'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['backup-status'] }),
  });

  if (!status.data || !meta.data) return <Pending queries={[status, meta]} />;
  const s = status.data;
  const texts = backupTexts({ storage: s.storage ?? 'disk', keep: s.keep ?? 14, copyDir: s.copyDir });

  return (
    <section>
      <StaleNotice queries={[status]} />
      <h1 className="mb-2 text-2xl font-bold">Резервное копирование</h1>
      <p className="mb-1 text-sm font-medium text-muted">{SHARED_NOTE}</p>
      <p className="mb-6 max-w-2xl text-sm text-muted">{texts.contents}</p>
      <section aria-labelledby={titleId} className="max-w-2xl rounded-2xl bg-field/60 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            Автоматическая копия
          </h2>
          <span className="rounded-full bg-income-soft px-2.5 py-0.5 text-xs font-semibold text-income-strong">Включено</span>
        </div>
        <p className="mb-4 text-sm">{texts.schedule}</p>
        <dl className="mb-4 grid gap-x-6 gap-y-2 text-sm md:grid-cols-[16rem_1fr]">
          {/* последний архив любого вида: ежедневный, стартовый, перед миграцией */}
          <dt className="text-muted">Последняя копия</dt>
          <dd>{s.last ? `${formatDateTime(s.last.createdAt, meta.data.timezone)} · ${formatBytes(s.last.size)}` : 'Ещё не было'}</dd>
          <dt className="text-muted">{texts.placeLabel}</dt>
          <dd className="break-all">{texts.place}</dd>
        </dl>
        {s.lastCopyError && (
          <p role="alert" className={alertClass}>
            {s.lastCopyError}
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
    </section>
  );
}
