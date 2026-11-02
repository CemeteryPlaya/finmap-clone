import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDateTime } from '../../../shared/dates';
import type { SenetHistoryCheck } from '../../../shared/schemas/senet';
import { api, type ApiError } from '../../lib/api';
import { localInputToIso } from '../../lib/senet';
import { historySummary } from '../../lib/senet-rules';
import { formatMoney } from '../../../shared/money';
import { alertClass, btnPrimary, inputClass } from '../ui';

const REASONS: Record<string, string> = {
  unrecognized: 'правило не нашлось',
  name_only: 'только имя сотрудника',
  salary_no_name: 'ЗП без имени',
  rule_broken: 'правило ссылается на архивную категорию или контрагента',
};

/** «Проверить на истории» (§8.1): текущие правила по сохранённым выемкам клуба, без записи. */
export function HistoryCheck(props: { companyId: number; offices: { id: number; label: string }[]; timeZone: string }) {
  const [officeId, setOfficeId] = useState<number | null>(props.offices[0]?.id ?? null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const check = useMutation<SenetHistoryCheck, ApiError>({
    mutationFn: () =>
      api(`/companies/${props.companyId}/senet/rules/check-history`, {
        method: 'POST',
        body: { officeId, from: localInputToIso(`${from}T00:00`, props.timeZone), to: localInputToIso(`${to}T23:59`, props.timeZone) },
      }),
  });
  if (props.offices.length === 0) return null;
  const r = check.data;
  return (
    <section className="rounded-xl border border-field p-3">
      <h3 className="font-semibold">Проверить на истории</h3>
      <p className="text-sm text-muted">Текущие правила по уже загруженным выемкам — ничего не записывается</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <select aria-label="Клуб" value={officeId ?? ''} onChange={(e) => setOfficeId(Number(e.target.value))} className={`${inputClass} sm:w-56`}>
          {props.offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <input aria-label="С даты" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} sm:w-56`} />
        <input aria-label="По дату" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} sm:w-56`} />
        <button type="button" className={btnPrimary} disabled={!officeId || !from || !to || check.isPending} onClick={() => check.mutate()}>
          Проверить на истории
        </button>
      </div>
      {check.error && <p className={`${alertClass} mt-2 mb-0`}>{check.error.message}</p>}
      {r && (
        <div className="mt-3 text-sm">
          <p role="status" className="font-semibold">
            {historySummary(r)}
          </p>
          {r.unrecognized.length > 0 && (
            <ul className="mt-2 grid gap-1">
              {r.unrecognized.map((u) => (
                <li key={u.moveId}>
                  {formatDateTime(u.at, props.timeZone)} · {formatMoney(u.amount, 'KZT')} · «{u.comment || '(без комментария)'}» — {REASONS[u.reason] ?? u.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
