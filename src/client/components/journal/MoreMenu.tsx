import { useId, useState } from 'react';
import { Link } from 'react-router';
import { focusHeadingSoon, isPlainLeftClick, pathOf } from '../../lib/focus-heading';
import type { JournalUrlState } from '../../lib/journal-filter';
import { ColumnsIcon, DownloadIcon, RefreshIcon } from '../icons';
import { Popover } from '../Popover';
import { AmountRange } from './AmountRange';
import { ColumnsPanel } from './ColumnsPanel';

const iconButton =
  'grid size-10 shrink-0 place-items-center rounded-xl bg-field text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus aria-disabled:cursor-wait aria-disabled:opacity-60';

interface MoreProps {
  companyId: number;
  state: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  currencySymbol: string;
  minorUnits: number;
  exportHref: string;
  /** ⟳: журнал, счета с балансами и компании перечитываются (§2.5). */
  onRefresh: () => Promise<void>;
}

function MorePanel(props: MoreProps) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const columnsId = useId();
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
        <a href={props.exportHref} download aria-label="Выгрузить в Excel" title="Выгрузить в Excel" className={iconButton}>
          <DownloadIcon />
        </a>
      </div>
      <p role="status" className={status ? 'mt-2 text-xs text-muted' : 'sr-only'}>
        {status}
      </p>
      {columnsOpen && (
        <div id={columnsId} className="mt-3 border-t border-field pt-3">
          <ColumnsPanel />
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
 * «Ещё ▾» (§5.1 этапа 1.5): в одну строку — «Сумма» От/По в базовой валюте, ⟳ «Обновить», ▥ «Колонки»,
 * ⤓ «Выгрузить в Excel» (по текущему фильтру). ▥ раскрывает ниже в той же панели список колонок и ссылку
 * «Настройки журнала» — вложенного окна нет. Итог ⟳ — в живой области панели.
 */
export function MoreMenu(props: MoreProps) {
  return (
    <Popover
      label={
        <>
          Ещё <span aria-hidden="true">▾</span>
        </>
      }
      ariaLabel="Ещё"
      align="right"
      panelClassName="w-[30rem] max-w-[calc(100vw-1rem)]"
    >
      {() => <MorePanel {...props} />}
    </Popover>
  );
}
