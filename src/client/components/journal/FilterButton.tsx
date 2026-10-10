import type { SavedFilter } from '../../lib/queries';
import { FunnelIcon } from '../icons';
import { SavedFiltersMenu } from './SavedFiltersMenu';

const partClass = 'inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus';

/**
 * Составная кнопка «Фильтр · N | ▾» (§5.1 этапа 1.5): левая часть открывает окно фильтра (N — число условий окна),
 * стрелка — «Быстрые фильтры» (сохранённые). canSave = false (архивная компания) — без «Создать новый фильтр».
 */
export function FilterButton(props: {
  count: number;
  onOpen: () => void;
  canSave: boolean;
  companyId: number;
  filters: SavedFilter[] | undefined;
  onApply: (f: SavedFilter) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-lg bg-field">
      <button type="button" aria-haspopup="dialog" onClick={props.onOpen} className={`${partClass} rounded-l-lg px-3`}>
        <FunnelIcon />
        Фильтр{props.count > 0 && ` · ${props.count}`}
      </button>
      <span aria-hidden="true" className="h-5 w-px bg-muted/40" />
      <SavedFiltersMenu
        companyId={props.companyId}
        filters={props.filters}
        onApply={props.onApply}
        onCreate={props.canSave ? props.onOpen : undefined}
        buttonClassName={`${partClass} rounded-r-lg px-2.5`}
      />
    </div>
  );
}
