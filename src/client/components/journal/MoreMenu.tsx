import { useId, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../../lib/focus-heading';
import type { JournalUrlState } from '../../lib/journal-filter';
import { ColumnsIcon, DownloadIcon, RefreshIcon } from '../icons';
import { Caret, Popover } from '../Popover';
import { AmountRange } from './AmountRange';
import { ColumnsPanel } from './ColumnsPanel';
import { ExportBuilderDialog } from './ExportBuilderDialog';

const iconButton =
  'grid size-10 shrink-0 place-items-center rounded-xl bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus aria-disabled:cursor-wait aria-disabled:opacity-60';
/** Пункт раздела «Экспортировать в»: строка во всю ширину. */
const exportItem = 'block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-field focus-visible:outline-2 focus-visible:outline-focus';

interface MoreProps {
  companyId: number;
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  currencySymbol: string;
  minorUnits: number;
  /** Сегодня в APP_TIMEZONE: «Собрать Excel» строит превью и ссылку по тому же фильтру, что журнал. */
  today: string;
  /** Ссылка «Excel» — выгрузка в формате Finmap по текущему фильтру (§8.2 спецификации импорта). */
  exportHref: string;
  /** ⟳: журнал, счета с балансами и компании перечитываются (§2.5). */
  onRefresh: () => Promise<void>;
  /** Сбой сохранения колонок или «Показывать полностью» после закрытия панели — страница показывает его плашкой. */
  onPrefError?: (text: string) => void;
}

function MorePanel(props: MoreProps & { close: (returnFocus?: boolean) => void; onBuilder: () => void }) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const columnsId = useId();
  const exportId = useId();
  const settings = `/c/${props.companyId}/settings/journal`;

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setStatus('');
    try {
      await props.onRefresh();
      setStatus('Журнал обновлён');
    } catch {
      setStatus('Не удалось обновить журнал');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        <span className="py-2 text-sm font-semibold">Сумма, {props.currencySymbol}</span>
        <AmountRange state={props.state} onChange={props.onChange} minorUnits={props.minorUnits} />
        <button type="button" aria-label="Обновить" title="Обновить" aria-disabled={refreshing || undefined} onClick={() => void refresh()} className={iconButton}>
          <RefreshIcon spinning={refreshing} />
        </button>
        <button
          type="button"
          aria-label="Колонки"
          title="Колонки"
          aria-expanded={columnsOpen}
          aria-controls={columnsOpen ? columnsId : undefined}
          onClick={() => setColumnsOpen((v) => !v)}
          className={iconButton}
        >
          <ColumnsIcon />
        </button>
        <button
          type="button"
          aria-label="Экспорт"
          title="Экспорт"
          aria-expanded={exportOpen}
          aria-controls={exportOpen ? exportId : undefined}
          onClick={() => setExportOpen((v) => !v)}
          className={iconButton}
        >
          <DownloadIcon />
        </button>
      </div>
      <p role="status" className={status ? 'mt-2 text-xs text-muted' : 'sr-only'}>
        {status}
      </p>
      {exportOpen && (
        <div id={exportId} role="group" aria-label="Экспортировать в" className="mt-3 border-t border-field pt-3">
          <p aria-hidden="true" className="mb-1 px-3 text-xs font-semibold tracking-wide text-label uppercase">
            Экспортировать в
          </p>
          {/* закрытие — после того, как браузер начал скачивание: ссылка до этого должна остаться в странице */}
          <a href={props.exportHref} download onClick={() => setTimeout(() => props.close(true), 0)} className={exportItem}>
            Excel
          </a>
          <button type="button" onClick={props.onBuilder} className={exportItem}>
            Собрать Excel
          </button>
        </div>
      )}
      {columnsOpen && (
        <div id={columnsId} className="mt-3 border-t border-field pt-3">
          <ColumnsPanel onFailAway={props.onPrefError} />
          <Link
            to={settings}
            onClick={(e) => {
              if (isPlainLeftClick(e)) focusHeadingSoon(pathOf(settings));
            }}
            className="mt-3 inline-block text-sm font-semibold text-ink underline"
          >
            Настройки журнала
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * «Ещё ▾» (§5.1 этапа 1.5, §8.1 спецификации импорта): в одну строку — «Сумма» От/По в базовой валюте, ⟳ «Обновить»,
 * ▥ «Колонки», ⤓ «Экспорт». ▥ раскрывает ниже в той же панели список колонок и ссылку «Настройки журнала», ⤓ — раздел
 * «Экспортировать в» с пунктами «Excel» (ссылка-скачивание) и «Собрать Excel» (окно) — вложенного окна нет. Итог ⟳ — в
 * живой области панели. Окно «Собрать Excel» живёт здесь, а не в панели: панель закрывается, а окно остаётся.
 */
export function MoreMenu(props: MoreProps) {
  const [builderOpen, setBuilderOpen] = useState(false);
  // заданная сумма спрятана в закрытой панели — число границ («Ещё · 2») показывает, что журнал сужен
  const bounds = (props.state.amountMin !== undefined ? 1 : 0) + (props.state.amountMax !== undefined ? 1 : 0);
  return (
    <>
      <Popover
        label={
          <>
            Ещё{bounds > 0 && ` · ${bounds}`} <Caret />
          </>
        }
        ariaLabel={bounds > 0 ? `Ещё · ${bounds}, задана сумма` : 'Ещё'}
        panelLabel="Ещё"
        align="right"
        panelClassName="w-[30rem] max-w-[calc(100vw-1rem)]"
      >
        {(close) => (
          <MorePanel
            {...props}
            close={close}
            onBuilder={() => {
              // фокус возвращается на «Ещё»: окно вернёт его туда же при закрытии
              close(true);
              setBuilderOpen(true);
            }}
          />
        )}
      </Popover>
      <ExportBuilderDialog open={builderOpen} onClose={() => setBuilderOpen(false)} companyId={props.companyId} state={props.state} today={props.today} />
    </>
  );
}
