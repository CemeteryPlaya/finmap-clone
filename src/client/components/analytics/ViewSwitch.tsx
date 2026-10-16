import { VIEW_LABELS, type ReportView } from '../../lib/report-url';

const ICON: Record<ReportView, string> = {
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  table: 'M4 6h16M4 12h16M4 18h10',
};

/**
 * Вид отчёта «график / таблица» (§2.2, как у Finmap — две кнопки-иконки рядом с заголовком, на телефоне первыми в панели). Нажатая кнопка — aria-pressed;
 * имя кнопки — «График» или «Таблица». Вид хранится в адресе, но не считается изменённым контролом: «Сбросить» его не трогает.
 */
export function ViewSwitch(props: { value: ReportView; onChange: (view: ReportView) => void; phone?: boolean }) {
  return (
    <div role="group" aria-label="Вид отчёта" className="inline-flex shrink-0 rounded-full bg-field p-1">
      {(['chart', 'table'] as const).map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={props.value === view}
          aria-label={VIEW_LABELS[view]}
          title={VIEW_LABELS[view]}
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
