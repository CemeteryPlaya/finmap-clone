import { Fragment, useMemo, useState } from 'react';
import { NavLink, useOutletContext, useParams } from 'react-router';
import { formatMoney } from '../../shared/money';
import { Pending, StaleNotice } from '../components/QueryState';
import { ReviewQueue } from '../components/senet/ReviewQueue';
import { ShiftDetails } from '../components/senet/ShiftDetails';
import { btnSmall, inputClass } from '../components/ui';
import { useProjects } from '../lib/queries';
import { useMeta } from '../lib/query';
import { localInputToIso, useSenetConnections } from '../lib/senet';
import { defaultPeriod, SHIFT_STATE_TEXT, shiftPeriodLabel, useSenetShifts, type ShiftRow } from '../lib/senet-reconcile';
import { useSenetReview } from '../lib/senet-review';
import type { CompanyOutletContext } from './CompanyLayout';

const money = (v: number) => formatMoney(v, 'KZT');
const pair = (a: number, b: number) => (a === b ? money(a) : `${money(a)} / ${money(b)}`);
const tab = ({ isActive }: { isActive: boolean }) => `rounded-xl px-3 py-1.5 font-medium ${isActive ? 'bg-income text-white' : 'bg-field'}`;

/** Строка смены: на компьютере — строка таблицы, на телефоне — карточка (§8.3). */
function stateBadges(r: ShiftRow) {
  return r.states.map((s) => (
    <span key={s} className={`mr-1 inline-block rounded px-1.5 py-0.5 text-xs ${s === 'ok' ? 'bg-income-soft text-income-strong' : s === 'open' || s === 'not_posted' ? 'bg-field' : 'bg-expense-soft text-expense-strong'}`}>
      {SHIFT_STATE_TEXT[s]}
    </span>
  ));
}

function Shifts(props: { companyId: number; timeZone: string; readOnly: boolean }) {
  const projects = useProjects(props.companyId);
  const period = useMemo(() => defaultPeriod(new Date(), props.timeZone), [props.timeZone]);
  const [project, setProject] = useState<number | null>(null);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const shifts = useSenetShifts(props.companyId, { project, from, to, onlyDiff }, localInputToIso(`${from}T00:00`, props.timeZone) ?? '', localInputToIso(`${to}T23:59`, props.timeZone) ?? '');
  const label = (r: ShiftRow) => shiftPeriodLabel(r.openedAt, r.closedAt, props.timeZone);
  const toFirstDiff = () => {
    const id = shifts.data?.firstCashDiffId;
    if (!id) return;
    setOpen(id);
    document.querySelector(`[data-shift="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <select aria-label="Клуб" value={project ?? ''} onChange={(e) => setProject(e.target.value ? Number(e.target.value) : null)} className={`${inputClass} w-auto`}>
          <option value="">Все клубы</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input aria-label="С даты" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} w-auto`} />
        <input aria-label="По дату" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} w-auto`} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          Только с расхождениями
        </label>
        {shifts.data?.firstCashDiffId && (
          <button type="button" className={btnSmall} onClick={toFirstDiff}>
            К первому расхождению
          </button>
        )}
      </div>
      {!shifts.data ? (
        <Pending queries={[shifts]} />
      ) : shifts.data.rows.length === 0 ? (
        <p className="text-muted">Смен за период нет.</p>
      ) : (
        <>
          <StaleNotice queries={[shifts]} />
          <table className="w-full text-sm max-md:hidden">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-2">Смена</th>
                <th>Кассир</th>
                <th className="text-right">Выручка</th>
                <th className="text-right">Каспи</th>
                <th className="text-right">Касса</th>
                <th className="text-right">Выемки</th>
                <th className="text-right">Касса после смены: Senet / журнал</th>
                <th className="pl-3">Состояние</th>
              </tr>
            </thead>
            <tbody>
              {shifts.data.rows.map((r) => (
                <Fragment key={r.id}>
                  <tr
                    data-shift={r.id}
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                    className={`cursor-pointer border-t border-field hover:bg-field/60 ${r.id === shifts.data.firstCashDiffId ? 'bg-expense-soft/60' : ''}`}
                    aria-expanded={open === r.id}
                  >
                    <td className="py-2 whitespace-nowrap">{label(r)}</td>
                    <td>{r.cashier}</td>
                    <td className="text-right">
                      {money(r.revenue)}
                      {r.revenueTx !== null && r.revenueTx !== r.revenue && <span title={`Транзакции Senet: ${money(r.revenueTx)}`}> ⚠</span>}
                    </td>
                    <td className="text-right">{pair(r.kaspi.posted, r.kaspi.senet)}</td>
                    <td className="text-right">{pair(r.cash.posted, r.cash.senet)}</td>
                    <td className="text-right">
                      {r.moves.posted} из {r.moves.total}
                      {r.moves.queued > 0 && `, разобрать ${r.moves.queued}`}
                    </td>
                    <td className={`text-right ${r.cashAfter && r.cashAfter.senet !== r.cashAfter.journal ? 'font-semibold text-expense-strong' : ''}`}>
                      {r.cashAfter ? `${money(r.cashAfter.senet)} / ${money(r.cashAfter.journal)}` : '—'}
                    </td>
                    <td className="pl-3">{stateBadges(r)}</td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={8}>
                        <ShiftDetails companyId={props.companyId} shiftId={r.id} changed={r.states.includes('changed')} timeZone={props.timeZone} readOnly={props.readOnly} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              <tr className="border-t-2 border-field font-semibold">
                <td className="py-2" colSpan={2}>
                  Итого за период
                </td>
                <td className="text-right">{money(shifts.data.totals.revenue)}</td>
                <td className="text-right">{pair(shifts.data.totals.kaspi.posted, shifts.data.totals.kaspi.senet)}</td>
                <td className="text-right">{pair(shifts.data.totals.cash.posted, shifts.data.totals.cash.senet)}</td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
          <ul className="grid gap-2 md:hidden">
            {shifts.data.rows.map((r) => (
              <li key={r.id} data-shift={r.id} className={`rounded-xl border border-field p-3 ${r.id === shifts.data.firstCashDiffId ? 'bg-expense-soft/60' : ''}`}>
                <button type="button" className="w-full text-left" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className="block font-semibold">{label(r)}</span>
                  <span className="block text-sm">
                    Выручка {money(r.revenue)} · Каспи {money(r.kaspi.posted)} · Касса {money(r.cash.posted)}
                  </span>
                  {r.cashAfter && (
                    <span className="block text-sm">
                      Касса после смены: {money(r.cashAfter.senet)} / {money(r.cashAfter.journal)}
                    </span>
                  )}
                  <span className="mt-1 block">{stateBadges(r)}</span>
                </button>
                {open === r.id && <ShiftDetails companyId={props.companyId} shiftId={r.id} changed={r.states.includes('changed')} timeZone={props.timeZone} readOnly={props.readOnly} />}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** «Сверка Senet» (§8.3–8.4): смены с остатком кассы Senet / журнал и очередь «Разобрать». */
export function SenetPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const { tab: current = 'shifts' } = useParams();
  const meta = useMeta();
  const connections = useSenetConnections(company.id);
  const review = useSenetReview(company.id);
  const timeZone = meta.data?.timezone ?? 'Asia/Almaty';
  if (!connections.data) return <Pending queries={[connections]} />;
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Сверка Senet</h1>
      <nav className="mb-4 flex gap-2" aria-label="Разделы сверки">
        <NavLink to={`/c/${company.id}/senet/shifts`} className={tab}>
          Смены
        </NavLink>
        <NavLink to={`/c/${company.id}/senet/review`} className={tab}>
          Разобрать{review.data?.length ? ` (${review.data.length})` : ''}
        </NavLink>
      </nav>
      {current === 'review' ? <ReviewQueue companyId={company.id} timeZone={timeZone} /> : <Shifts companyId={company.id} timeZone={timeZone} readOnly={company.archivedAt !== null} />}
    </div>
  );
}
