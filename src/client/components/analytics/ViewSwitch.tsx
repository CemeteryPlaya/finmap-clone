import { VIEW_LABELS, type ReportView } from '../../lib/report-url';

/** Виды отчётов: финансовые — «график / таблица», у отчётов клуба ещё «по часам» (спецификация «Аналитика клуба», §5.3). */
type AnyView = ReportView | 'hours';
const LABELS: Record<AnyView, string> = { ...VIEW_LABELS, hours: 'По часам' };
const ICON: Record<AnyView, string> = {
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  table: 'M4 6h16M4 12h16M4 18h10',
  hours: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2',
};
const FINANCE_VIEWS: readonly ReportView[] = ['chart', 'table'];

/**
 * Вид отчёта «график / таблица» (§2.2, как у Finmap — две кнопки-иконки рядом с заголовком, на телефоне первыми в панели). Нажатая кнопка — aria-pressed;
 * имя кнопки — «График» или «Таблица». Вид хранится в адресе, но не считается изменённым контролом: «Сбросить» его не трогает.
 */
export function ViewSwitch<V extends AnyView = ReportView>(props: { value: V; onChange: (view: V) => void; phone?: boolean; views?: readonly V[] }) {
  const views = props.views ?? (FINANCE_VIEWS as readonly V[]);
  return (
    <div role="group" aria-label="Вид отчёта" className="inline-flex shrink-0 rounded-full bg-field p-1">
      {views.map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={props.value === view}
          aria-label={LABELS[view]}
          title={LABELS[view]}
          onClick={() => props.onChange(view)}
          className={`grid ${props.phone ? 'size-11' : 'size-8'} place-items-center rounded-full text-ink hover:bg-card/60 focus-visible:outline-2 focus-visible:outline-focus aria-pressed:bg-ink aria-pressed:text-card`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICON[view]} />
          </svg>
        </button>
      ))}
    </div>
  );
}
