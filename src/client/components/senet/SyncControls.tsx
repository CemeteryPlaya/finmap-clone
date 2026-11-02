import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { SenetSyncRunDto } from '../../../shared/schemas/senet';
import { api, type ApiError } from '../../lib/api';
import { invalidateSenet, localInputToIso, syncSummary } from '../../lib/senet';
import { Field } from '../Field';
import { btnSmall, inputClass } from '../ui';

type RunResult = Pick<SenetSyncRunDto, 'result' | 'error' | 'counts'>;

/**
 * «Обновить сейчас» и «Загрузить за период» (С15§5.4): пока идёт забор, кнопки недоступны; итог — строкой
 * «Загружено N из M отрезков». Период — не больше 366 дней, режется на отрезки по 7 дней.
 */
export function SyncControls(props: { companyId: number; connectionId: number; timeZone: string }) {
  const [period, setPeriod] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const sync = useMutation<{ runs: RunResult[] }, ApiError, { from?: string; to?: string }>({
    mutationFn: (body) => api(`/companies/${props.companyId}/senet/connections/${props.connectionId}/sync`, { method: 'POST', body }),
    onSettled: () => invalidateSenet(props.companyId),
  });
  const run = sync.data?.runs[0];
  return (
    <div className="mt-2 grid gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSmall} disabled={sync.isPending} onClick={() => sync.mutate({})}>
          Обновить сейчас
        </button>
        <button type="button" className={btnSmall} disabled={sync.isPending} onClick={() => setPeriod((p) => !p)} aria-expanded={period}>
          Загрузить за период
        </button>
      </div>
      {period && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="С">{(c) => <input {...c} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />}</Field>
          <Field label="По" error={sync.error?.fields?.to ?? sync.error?.fields?.from}>
            {(c) => <input {...c} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />}
          </Field>
          <button
            type="button"
            className={btnSmall}
            disabled={sync.isPending || !from || !to}
            onClick={() => sync.mutate({ from: localInputToIso(from, props.timeZone) ?? undefined, to: localInputToIso(to, props.timeZone) ?? undefined })}
          >
            Загрузить
          </button>
        </div>
      )}
      <p role="status" className="text-sm text-muted">
        {sync.isPending ? 'Забираем данные Senet…' : run ? syncSummary(run) : sync.error && !sync.error.fields ? sync.error.message : ''}
      </p>
    </div>
  );
}
