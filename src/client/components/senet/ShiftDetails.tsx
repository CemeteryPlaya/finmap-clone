import { useMutation } from '@tanstack/react-query';
import { formatDateTime } from '../../../shared/dates';
import { formatMoney } from '../../../shared/money';
import { api, type ApiError } from '../../lib/api';
import { invalidateOperations } from '../../lib/journal-mutations';
import { invalidateSenet } from '../../lib/senet';
import { useSenetShift } from '../../lib/senet-reconcile';
import { Pending } from '../QueryState';
import { alertClass, btnPrimary, btnSmall } from '../ui';

const money = (v: number) => formatMoney(v, 'KZT');

/** Раскрытая смена (§8.3): выемки с операциями и «Не проводить повторно», доходы, предупреждения, «Перепровести доходы». */
export function ShiftDetails(props: { companyId: number; shiftId: number; changed: boolean; timeZone: string; readOnly: boolean }) {
  const detail = useSenetShift(props.companyId, props.shiftId);
  const act = useMutation<unknown, ApiError, { url: string; method: 'PATCH' | 'POST'; body?: unknown }>({
    mutationFn: (x) => api(x.url, { method: x.method, body: x.body }),
    onSuccess: () => Promise.all([invalidateSenet(props.companyId), invalidateOperations(props.companyId)]),
  });
  if (!detail.data) return <Pending queries={[detail]} />;
  const d = detail.data;
  const noRepost = (body: object) => act.mutate({ url: `/companies/${props.companyId}/senet/shifts/${props.shiftId}/no-repost`, method: 'PATCH', body });
  return (
    <div className="grid gap-3 bg-field/40 p-3 text-sm">
      {d.warnings.map((w) => (
        <p key={w} className="text-expense-strong">
          {w}
        </p>
      ))}
      <ul className="grid gap-1">
        {d.moves.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-field py-1">
            <span>
              {formatDateTime(m.at, props.timeZone).slice(-5)} · {m.kind === 'in' ? 'внесение' : 'выемка'} {money(m.amount)}
              {m.comment && ` · «${m.comment}»`}
              {m.missingInSenet && <span className="ml-2 text-expense-strong">исчезла из Senet</span>}
            </span>
            <span className="flex items-center gap-2">
              {m.kind === 'out' && <span className="text-muted">{m.operationId ? 'проведена' : m.noRepost ? 'не проводить' : 'не проведена'}</span>}
              {m.kind === 'out' && !props.readOnly && (m.noRepost || !m.operationId) && (
                <button type="button" className={btnSmall} disabled={act.isPending} onClick={() => noRepost({ kind: 'move', moveId: m.id, noRepost: !m.noRepost })}>
                  {m.noRepost ? 'Проводить снова' : 'Не проводить повторно'}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      <ul className="grid gap-1">
        {d.incomes.map((i) => (
          <li key={i.kind} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              Доход «{i.kind === 'kaspi' ? 'Каспи' : 'Касса'}» {money(i.amount)} — {i.operationId ? 'в журнале' : i.noRepost ? 'не проводить' : 'удалён в журнале'}
            </span>
            {!props.readOnly && !i.operationId && (
              <button type="button" className={btnSmall} disabled={act.isPending} onClick={() => noRepost({ kind: i.kind, noRepost: !i.noRepost })}>
                {i.noRepost ? 'Проводить снова' : 'Не проводить повторно'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {props.changed && !props.readOnly && (
        <div>
          <button type="button" className={btnPrimary} disabled={act.isPending} onClick={() => act.mutate({ url: `/companies/${props.companyId}/senet/shifts/${props.shiftId}/repost-incomes`, method: 'POST' })}>
            Перепровести доходы смены
          </button>
        </div>
      )}
      {act.error && <p className={`${alertClass} mb-0`}>{act.error.message}</p>}
    </div>
  );
}
