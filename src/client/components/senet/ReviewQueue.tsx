import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { formatDateTime } from '../../../shared/dates';
import { formatMoney, parseAmount } from '../../../shared/money';
import type { SenetReviewAnswer, SenetReviewItemDto } from '../../../shared/schemas/senet';
import { api, type ApiError } from '../../lib/api';
import { invalidateOperations } from '../../lib/journal-mutations';
import { useCategories, useCounterparties, type CategoryNode } from '../../lib/queries';
import { invalidateSenet } from '../../lib/senet';
import { canRemember, REVIEW_REASONS, reviewAnswerKind, useSenetReview } from '../../lib/senet-review';
import { Pending } from '../QueryState';
import { alertClass, btnPrimary, btnSmall, inputClass } from '../ui';

type Option = { id: number; label: string };
const flat = (nodes: CategoryNode[], depth = 0): Option[] =>
  nodes.filter((n) => !n.archivedAt).flatMap((n) => [{ id: n.id, label: `${'— '.repeat(depth)}${n.name}` }, ...flat(n.children, depth + 1)]);

const shiftLabel = (i: SenetReviewItemDto, tz: string) => `${formatDateTime(i.shiftOpenedAt, tz)} — ${i.shiftClosedAt ? formatDateTime(i.shiftClosedAt, tz).slice(-5) : 'идёт'}`;

/** Карточка пункта (§8.4): смена, сумма, исходный комментарий, причина, предложения кнопками, ответ. */
function ReviewCard(props: { companyId: number; item: SenetReviewItemDto; categories: Option[]; counterparties: Option[]; timeZone: string }) {
  const { item } = props;
  const kind = reviewAnswerKind(item.reason);
  const [categoryId, setCategoryId] = useState<number | null>(item.suggestions[0]?.categoryId ?? null);
  const [counterpartyId, setCounterpartyId] = useState<number | null>(item.suggestions[0]?.counterpartyId ?? null);
  const [comment, setComment] = useState('');
  const [remember, setRemember] = useState(false);
  const [kaspi, setKaspi] = useState('');
  const [cash, setCash] = useState('');
  const send = useMutation<unknown, ApiError, SenetReviewAnswer>({
    mutationFn: (body) => api(`/companies/${props.companyId}/senet/review/${item.id}/answer`, { method: 'POST', body }),
    onSuccess: () => Promise.all([invalidateSenet(props.companyId), invalidateOperations(props.companyId)]),
  });
  const money = (text: string) => parseAmount(text || '0', 2) ?? 0;
  const select = (label: string, value: number | null, options: Option[], onChange: (id: number | null) => void) => (
    <label className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={inputClass}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <article className="rounded-xl border border-field p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted">Смена {shiftLabel(item, props.timeZone)}</span>
        {item.amount !== null && <span className="font-semibold">{formatMoney(item.amount, 'KZT')}</span>}
      </div>
      {item.cashMoveId !== null && <p className="mt-1">«{item.comment || '(без комментария)'}»</p>}
      <p className="text-sm text-expense-strong">{REVIEW_REASONS[item.reason]}</p>
      {kind === 'expense' && (
        <>
          {item.suggestions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.suggestions.map((s) => (
                <button
                  key={`${s.categoryId}-${s.counterpartyId}`}
                  type="button"
                  className={btnSmall}
                  onClick={() => {
                    setCategoryId(s.categoryId);
                    setCounterpartyId(s.counterpartyId);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {select('Категория', categoryId, props.categories, setCategoryId)}
            {select('Контрагент', counterpartyId, props.counterparties, setCounterpartyId)}
            <label className="grid gap-1 text-sm">
              <span className="text-muted">Комментарий</span>
              <input value={comment} onChange={(e) => setComment(e.target.value)} className={inputClass} />
            </label>
          </div>
          {canRemember(item) && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Запомнить для «{item.comment}»
            </label>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={!categoryId || send.isPending}
              onClick={() => send.mutate({ kind: 'expense', categoryId: categoryId!, counterpartyId, comment: comment.trim() || null, remember })}
            >
              Провести
            </button>
            <button type="button" className={btnSmall} disabled={send.isPending} onClick={() => send.mutate({ kind: 'dismiss' })}>
              Пропустить
            </button>
          </div>
        </>
      )}
      {kind === 'kaspi' && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Каспи за смену, ₸</span>
            <input inputMode="decimal" value={kaspi} onChange={(e) => setKaspi(e.target.value)} className={inputClass} />
          </label>
          <button type="button" className={btnPrimary} disabled={!money(kaspi) || send.isPending} onClick={() => send.mutate({ kind: 'kaspi', amount: money(kaspi) })}>
            Указать Каспи
          </button>
          <button type="button" className={btnSmall} disabled={send.isPending} onClick={() => send.mutate({ kind: 'kaspi', amount: 0 })}>
            Каспи не было
          </button>
        </div>
      )}
      {kind === 'incomes' && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Каспи, ₸</span>
            <input inputMode="decimal" value={kaspi} onChange={(e) => setKaspi(e.target.value)} className={inputClass} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Касса, ₸</span>
            <input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} className={inputClass} />
          </label>
          <button type="button" className={btnPrimary} disabled={send.isPending} onClick={() => send.mutate({ kind: 'incomes', kaspi: money(kaspi), cash: money(cash) })}>
            Провести доходы
          </button>
          <button type="button" className={btnSmall} disabled={send.isPending} onClick={() => send.mutate({ kind: 'dismiss' })}>
            Не проводить доходы смены
          </button>
        </div>
      )}
      {send.error && <p className={`${alertClass} mt-2 mb-0`}>{send.error.message}</p>}
    </article>
  );
}

/** Очередь «Разобрать» (§8.4). */
export function ReviewQueue(props: { companyId: number; timeZone: string }) {
  const items = useSenetReview(props.companyId);
  const categories = useCategories(props.companyId);
  const counterparties = useCounterparties(props.companyId);
  if (!items.data || !categories.data || !counterparties.data) return <Pending queries={[items, categories, counterparties]} />;
  if (items.data.length === 0) return <p className="text-muted">Разбирать нечего — все выемки проведены.</p>;
  const cats = flat(categories.data.expense);
  const cps = counterparties.data.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, label: c.name }));
  return (
    <div className="grid gap-3">
      {items.data.map((i) => (
        <ReviewCard key={i.id} companyId={props.companyId} item={i} categories={cats} counterparties={cps} timeZone={props.timeZone} />
      ))}
    </div>
  );
}
