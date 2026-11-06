import type { CohortRow } from '../../../shared/club-analytics/guests';
import { cohortMonthText, shareText } from '../../lib/club-guests';

const cell = 'px-3 py-2 text-right whitespace-nowrap tabular-nums';

/**
 * Когорты (спецификация «Аналитика клуба», §7.3, R24): месяц первого визита × месяцев спустя. Ячейка — доля гостей
 * когорты, пришедших в тот месяц; месяц, который ещё не наступил, пуст.
 */
export function CohortTable(props: { rows: readonly CohortRow[]; busy: boolean }) {
  return (
    <section className="mt-6">
      <h2 className="mb-1 text-base font-bold text-ink">Когорты</h2>
      <p className="mb-2 text-sm text-muted">Какая доля гостей месяца первого визита пришла снова через 1…6 месяцев</p>
      <div role="region" aria-label="Когорты" tabIndex={0} className="overflow-x-auto rounded-xl focus-visible:outline-2 focus-visible:outline-focus">
        <table aria-busy={props.busy} className={`w-full min-w-max border-collapse text-sm ${props.busy ? 'opacity-60' : ''}`}>
          <caption className="sr-only">Когорты: месяц первого визита × месяцев спустя</caption>
          <thead>
            <tr className="h-10 border-b border-field text-xs font-semibold text-muted">
              <th scope="col" className="sticky left-0 z-10 bg-card px-3 text-left">
                Месяц
              </th>
              <th scope="col" className="px-3 text-right">
                Гостей
              </th>
              {Array.from({ length: 7 }, (_, k) => (
                <th key={k} scope="col" className="px-3 text-right">
                  {`${k} мес.`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.month} className="border-b border-field">
                <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal">
                  {cohortMonthText(r.month)}
                </th>
                <td className={cell}>{r.size}</td>
                {r.shares.map((s, k) => (
                  <td key={k} className={cell}>
                    {s === null ? '' : shareText(s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
