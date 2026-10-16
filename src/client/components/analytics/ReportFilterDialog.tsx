import { useState } from 'react';
import type { DialogFields } from '../../lib/journal-filter';
import { dimensionOptions, dimensionSelected, REPORT_DIMENSIONS, toggleDimension, type FilterDialogData } from '../../lib/journal-filter-dialog';
import { DEFAULT_REPORT_STATE, reportDialogFields, withDialogFields, type ReportUrlState } from '../../lib/report-url';
import { Modal } from '../Modal';
import { MultiSelectField } from '../MultiSelectField';
import { btnPrimary, phoneFullScreenModal } from '../ui';

/**
 * Поля окна: черновик — условия фильтра (§2.4 спецификации «Аналитика»); «Готово» применяет его поверх текущих настроек
 * отчёта, «Сбросить» очищает черновик, «×» и Esc закрывают без изменений. Поля и их пункты — те же, что у фильтра журнала,
 * без типов операций.
 */
function ReportFilterForm(props: { state: ReportUrlState; data: FilterDialogData; onApply: (next: ReportUrlState) => void }) {
  const [draft, setDraft] = useState<DialogFields>(() => reportDialogFields(props.state));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onApply(withDialogFields(props.state, draft));
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        {REPORT_DIMENSIONS.map((d) => (
          <div key={d.dim} className={`min-w-0 ${d.dim === 'typesCategories' ? 'md:col-span-2' : ''}`}>
            <MultiSelectField
              label={d.label}
              allLabel={d.allLabel}
              options={dimensionOptions(d.dim, props.data, draft, { types: false })}
              selected={dimensionSelected(d.dim, draft)}
              onToggle={(key) => setDraft((current) => toggleDimension(d.dim, current, key))}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Родительская категория включает подкатегории. При фильтре по категориям, контрагентам, проектам или тегам остатки не считаются — фильтр по счетам их
        сохраняет.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-6 max-md:bg-card max-md:px-6 max-md:py-3">
        <button type="submit" className={`${btnPrimary} max-md:basis-full`}>
          Готово
        </button>
        <button type="button" onClick={() => setDraft(reportDialogFields(DEFAULT_REPORT_STATE))} className="text-sm font-semibold text-muted underline hover:text-ink">
          Сбросить
        </button>
      </div>
    </form>
  );
}

/** Окно «Фильтры» отчёта (§2.4): категории с подкатегориями, контрагенты, проекты, теги, счета; по умолчанию — «Все». */
export function ReportFilterDialog(props: { open: boolean; state: ReportUrlState; data: FilterDialogData; onApply: (next: ReportUrlState) => void; onClose: () => void }) {
  return (
    <Modal open={props.open} title="Фильтры" onClose={props.onClose} className={`max-w-[818px] ${phoneFullScreenModal}`} phoneFullScreen>
      <ReportFilterForm
        state={props.state}
        data={props.data}
        onApply={(next) => {
          props.onApply(next);
          props.onClose();
        }}
      />
    </Modal>
  );
}
