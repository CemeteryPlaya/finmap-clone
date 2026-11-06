import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { visitTimeText, type GuestCardView, type GuestFound } from '../../lib/club-guests';
import { durationText } from '../../lib/club-load';
import { clubMoney } from '../../lib/club-revenue';
import { alertClass, btnClose, btnSecondary, btnSmall, inputClass } from '../ui';

type LinkBody = { kind: 'merge' | 'split'; a: string; b: string };

/** Параметры карточки: период и клуб отчёта, без шага и сравнения. */
function cardParams(apiParams: string): string {
  const p = new URLSearchParams(apiParams);
  p.delete('step');
  p.delete('compare');
  return p.toString();
}

/** Поиск другого гостя для «Это один гость» (§7.1): от 2 знаков, с задержкой 300 мс. */
function MergeSearch(props: { base: string; companyId: number; self: string; busy: boolean; onMerge: (ref: string) => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const found = useQuery({
    queryKey: ['analytics', props.companyId, 'club', 'guest-search', q],
    queryFn: () => api<GuestFound[]>(`${props.base}/search?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const id = useId();
  const others = (found.data ?? []).filter((g) => g.ref !== props.self);
  return (
    <div className="mt-4">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        Это один гость
      </label>
      <input id={id} value={text} onChange={(e) => setText(e.target.value)} placeholder="Логин или последние цифры телефона" className={inputClass} />
      {q.length >= 2 && found.data && others.length === 0 && <p className="mt-2 text-sm text-muted">Никого не нашлось</p>}
      {others.length > 0 && (
        <ul aria-label="Найденные гости" className="mt-2 flex flex-col gap-2">
          {others.map((g) => (
            <li key={g.ref} className="flex items-center justify-between gap-3 text-sm">
              <span>{[g.logins.join(', '), g.masks.join(', ')].filter(Boolean).join(' · ')}</span>
              <button type="button" disabled={props.busy} onClick={() => props.onMerge(g.ref)} className={btnSmall}>
                Объединить
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Карточка гостя (спецификация «Аналитика клуба», §7.4): логины и маски, итоги и визиты за период, ручные правки.
 * «Разделить» вынимает логин или телефон из автоматических связей, «Это один гость» объединяет с найденным, «Снять» —
 * отменяет правку. У архивной компании кнопок правки нет.
 */
export function GuestCard(props: { companyId: number; guestRef: string; apiParams: string; timeZone: string; archived: boolean; onClose: () => void }) {
  const base = `/companies/${props.companyId}/club-analytics/guests`;
  const params = cardParams(props.apiParams);
  const qc = useQueryClient();
  const card = useQuery({
    queryKey: ['analytics', props.companyId, 'club', 'guest', props.guestRef, params],
    queryFn: () => api<GuestCardView>(`${base}/${props.guestRef}?${params}`),
  });
  const done = () => qc.invalidateQueries({ queryKey: ['analytics', props.companyId, 'club'] });
  const link = useMutation<{ id: number }, ApiError, LinkBody>({ mutationFn: (body) => api(`${base}/links`, { method: 'POST', body }), onSuccess: done });
  const unlink = useMutation<void, ApiError, number>({ mutationFn: (id) => api(`${base}/links/${id}`, { method: 'DELETE' }), onSuccess: done });
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [props.guestRef]);
  const busy = link.isPending || unlink.isPending;
  const error = link.error ?? unlink.error;
  const c = card.data;
  const keys = c ? c.logins.length + c.phones.length : 0;
  const title = c ? c.logins.map((l) => l.login).join(', ') || c.phones.map((p) => p.mask).join(', ') : 'Гость';
  const split = (ref: string) =>
    !props.archived &&
    keys > 1 && (
      <button type="button" disabled={busy} onClick={() => link.mutate({ kind: 'split', a: ref, b: c!.ref })} className={btnSmall}>
        Разделить
      </button>
    );

  return (
    <section aria-label="Карточка гостя" className="mt-6 rounded-xl bg-card p-4 ring-1 ring-field">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
          {title}
        </h2>
        <button type="button" aria-label="Закрыть карточку" title="Закрыть" onClick={props.onClose} className={btnClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {!c && !card.error && <p className="py-4 text-muted">Загрузка…</p>}
      {card.error && (
        <p role="alert" className={alertClass}>
          {(card.error as ApiError).message}
        </p>
      )}
      {c && (
        <>
          {error && (
            <p role="alert" className={`${alertClass} mb-3`}>
              {error.message}
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <section>
              <h3 className="mb-1 text-sm font-semibold text-muted">Логины</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {c.logins.length === 0 && <li className="text-muted">—</li>}
                {c.logins.map((l) => (
                  <li key={l.ref} className="flex items-center justify-between gap-3">
                    {l.login}
                    {split(l.ref)}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-1 text-sm font-semibold text-muted">Телефоны</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {c.phones.length === 0 && <li className="text-muted">—</li>}
                {c.phones.map((p) => (
                  <li key={p.ref} className="flex items-center justify-between gap-3">
                    {p.mask}
                    {split(p.ref)}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <p className="mt-4 text-sm">{`Визитов: ${c.totals.visits} · ${durationText(c.totals.visitSec)} · Потратил ${clubMoney(c.totals.spent)} · Пополнил ${clubMoney(c.totals.refilled)}`}</p>
          {c.visits.length > 0 && (
            <div role="region" aria-label="Визиты гостя" tabIndex={0} className="mt-3 overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
              <table className="w-full min-w-max border-collapse text-sm">
                <caption className="sr-only">Визиты гостя за период</caption>
                <thead>
                  <tr className="h-10 border-b border-field text-xs font-semibold text-muted">
                    <th scope="col" className="px-3 text-left">Визит</th>
                    <th scope="col" className="px-3 text-left">Места</th>
                    <th scope="col" className="px-3 text-right">Списано</th>
                  </tr>
                </thead>
                <tbody>
                  {c.visits.map((v) => (
                    <tr key={v.startAt} className="border-b border-field">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{visitTimeText(v.startAt, v.endAt, props.timeZone)}</td>
                      <td className="px-3 py-2">{v.places}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{clubMoney(v.spent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {c.edits.length > 0 && (
            <section className="mt-4">
              <h3 className="mb-1 text-sm font-semibold text-muted">Правки</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {c.edits.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3">
                    {e.label}
                    {!props.archived && (
                      <button type="button" disabled={busy} onClick={() => unlink.mutate(e.id)} className={btnSecondary}>
                        Снять
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!props.archived && <MergeSearch base={base} companyId={props.companyId} self={c.ref} busy={busy} onMerge={(ref) => link.mutate({ kind: 'merge', a: c.ref, b: ref })} />}
        </>
      )}
    </section>
  );
}
