import { btnClose } from '../ui';

/**
 * Плашка выбранной категории над отчётом (спецификация 2026-10-19, часть 3): «Категория: Зарплата ×» — видно, что отчёт
 * сужен; «×» снимает выбор.
 */
export function CategoryFocus(props: { label: string; onClear: () => void }) {
  return (
    <p className="mb-4 inline-flex max-w-full items-center gap-2 rounded-xl bg-income-soft py-1 pr-1 pl-3 text-sm text-ink">
      <span className="min-w-0 truncate" title={props.label}>
        Категория: <strong className="font-semibold">{props.label}</strong>
      </span>
      <button type="button" aria-label="Снять выбор категории" title="Снять выбор категории" onClick={props.onClear} className={`${btnClose} shrink-0`}>
        <span aria-hidden="true">×</span>
      </button>
    </p>
  );
}
