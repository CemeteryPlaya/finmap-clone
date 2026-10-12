import type { SavedFilter } from '../../lib/queries';
import { FunnelIcon } from '../icons';
import { SavedFiltersMenu } from './SavedFiltersMenu';

const partClass = 'inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Составная кнопка «Фильтр · N | ▾» (§5.1 этапа 1.5): левая часть открывает окно фильтра (N — число условий),
 * стрелка — «Быстрые фильтры» (сохранённые). canSave = false (архивная компания) — без «Создать новый фильтр».
 * compact — телефон (§8.5): воронка с числом вместо подписи (имя кнопки то же — «Фильтр · N»), цели касания 44 px.
 */
export function FilterButton(props: {
  count: number;
  onOpen: () => void;
  canSave: boolean;
  companyId: number;
  filters: SavedFilter[] | undefined;
  onApply: (f: SavedFilter) => void;
  compact?: boolean;
}) {
  const name = `Фильтр${props.count > 0 ? ` · ${props.count}` : ''}`;
  const size = props.compact ? ' min-h-11' : '';
  return (
    <div className="inline-flex shrink-0 items-center rounded-lg bg-field">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={props.compact ? name : undefined}
        title={props.compact ? 'Фильтр' : undefined}
        onClick={props.onOpen}
        className={`${partClass} rounded-l-lg px-3${size}`}
      >
        <FunnelIcon />
        {props.compact ? (
          props.count > 0 && (
            <span aria-hidden="true" className="tabular-nums">
              {props.count}
            </span>
          )
        ) : (
          name
        )}
      </button>
      <span aria-hidden="true" className="h-5 w-px bg-muted/40" />
      <SavedFiltersMenu
        companyId={props.companyId}
        filters={props.filters}
        onApply={props.onApply}
        onCreate={props.canSave ? props.onOpen : undefined}
        buttonClassName={`${partClass} rounded-r-lg px-2.5${size}`}
      />
    </div>
  );
}
