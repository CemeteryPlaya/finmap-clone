import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { formatDateTime } from '../../../shared/dates';
import type { SenetConnectionDto, SenetOfficeDto } from '../../../shared/schemas/senet';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
import { Pending, StaleNotice } from '../../components/QueryState';
import { ConnectionDialog } from '../../components/senet/ConnectionDialog';
import { OfficeForm } from '../../components/senet/OfficeForm';
import { alertClass, btnPrimary, btnSmall, noticeClass } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { useMeta } from '../../lib/query';
import { invalidateSenet, senetAddress, statusText, useSenetConnections } from '../../lib/senet';
import type { CompanyOutletContext } from '../CompanyLayout';

type Dialog = { kind: 'connection'; connection: SenetConnectionDto | null } | { kind: 'office'; connectionId: number; office: SenetOfficeDto | null } | null;

/**
 * «Интеграции» (спецификация 2026-11-02-senet-autopost, §8.1): карточка Senet — подключения, их клубы и связи.
 */
export function IntegrationsSettings() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const connections = useSenetConnections(company.id);
  const meta = useMeta();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [removing, setRemoving] = useState<SenetConnectionDto | null>(null);
  const readOnly = company.archivedAt !== null;
  const timeZone = meta.data?.timezone ?? 'Asia/Almaty';
  const act = useMutation<unknown, ApiError, { id: number; method: 'PATCH' | 'DELETE'; body?: unknown }>({
    mutationFn: (x) => api(`/companies/${company.id}/senet/connections/${x.id}`, { method: x.method, body: x.body }),
    onSuccess: () => invalidateSenet(company.id),
    onSettled: () => setRemoving(null),
  });

  if (!connections.data) return <Pending queries={[connections]} />;
  return (
    <section>
      <StaleNotice queries={[connections]} />
      <h1 className="mb-4 text-2xl font-bold">Интеграции</h1>
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      <div className="rounded-2xl border border-field p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">Senet</h2>
            <p className="text-sm text-muted">Смены клубов сами проводятся в журнал; нераспознанное — в «Разобрать»</p>
          </div>
          {!readOnly && (
            <button type="button" onClick={() => setDialog({ kind: 'connection', connection: null })} className={btnPrimary}>
              + Подключить Senet
            </button>
          )}
        </div>
        {act.error && (
          <p role="alert" className={alertClass}>
            {act.error.message}
          </p>
        )}
        {connections.data.length === 0 && <p className="text-muted">Подключений пока нет.</p>}
        {connections.data.map((c) => (
          <article key={c.id} className="mt-3 rounded-xl bg-field/50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{c.name}</h3>
                <p className="text-sm text-muted">
                  {senetAddress(c.org)} · {c.authMethod === 'token' ? 'токен' : 'вход'} {c.credentialsHint}
                </p>
                <p className={`text-sm ${c.status === 'ok' && !c.archivedAt ? 'text-muted' : 'text-expense-strong'}`}>{statusText(c, (iso) => formatDateTime(iso, timeZone))}</p>
                {c.lastError && c.status !== 'ok' && <p className="text-sm text-expense-strong">{c.lastError}</p>}
              </div>
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnSmall} onClick={() => setDialog({ kind: 'connection', connection: c })}>
                    Заменить данные входа
                  </button>
                  <button type="button" className={btnSmall} disabled={act.isPending} onClick={() => act.mutate({ id: c.id, method: 'PATCH', body: { archived: !c.archivedAt } })}>
                    {c.archivedAt ? 'Включить' : 'Отключить'}
                  </button>
                  <button type="button" className={btnSmall} onClick={() => setRemoving(c)}>
                    Удалить
                  </button>
                </div>
              )}
            </div>
            <ul className="mt-2 grid gap-1">
              {c.offices.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-field py-2">
                  <span>
                    {o.name || `Клуб ${o.senetOfficeId}`} · касса {o.cashDeskId}
                    <span className="ml-2 text-sm text-muted">{o.enabled ? 'забирается' : 'выключен'}</span>
                  </span>
                  {!readOnly && (
                    <button type="button" className={btnSmall} onClick={() => setDialog({ kind: 'office', connectionId: c.id, office: o })}>
                      Изменить
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!readOnly && (
              <button type="button" className={`${btnSmall} mt-2`} onClick={() => setDialog({ kind: 'office', connectionId: c.id, office: null })}>
                + Клуб
              </button>
            )}
          </article>
        ))}
      </div>
      <Modal open={dialog?.kind === 'connection'} title={dialog?.kind === 'connection' && dialog.connection ? 'Данные входа Senet' : 'Подключить Senet'} onClose={() => setDialog(null)} className="max-w-lg">
        {dialog?.kind === 'connection' && <ConnectionDialog companyId={company.id} timeZone={timeZone} connection={dialog.connection} onDone={() => setDialog(null)} />}
      </Modal>
      <Modal open={dialog?.kind === 'office'} title="Клуб Senet" onClose={() => setDialog(null)} className="max-w-lg">
        {dialog?.kind === 'office' && <OfficeForm companyId={company.id} connectionId={dialog.connectionId} timeZone={timeZone} office={dialog.office} onDone={() => setDialog(null)} />}
      </Modal>
      <ConfirmDialog
        open={removing !== null}
        title="Удалить подключение?"
        danger
        text={`Подключение «${removing?.name ?? ''}» и забранные данные будут удалены. Если из него уже проведены операции — его можно только отключить.`}
        confirmLabel="Удалить"
        pending={act.isPending}
        onConfirm={() => removing && act.mutate({ id: removing.id, method: 'DELETE' })}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}
