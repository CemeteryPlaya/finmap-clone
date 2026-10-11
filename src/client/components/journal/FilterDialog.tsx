import { useState } from 'react';
import { ApiError } from '../../lib/api';
import { pickDialogFields, type DialogFields, type JournalUrlState } from '../../lib/journal-filter';
import { DIMENSIONS, dimensionOptions, dimensionSelected, toggleDimension, type FilterDialogData, type FilterDimension } from '../../lib/journal-filter-dialog';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { MultiSelectField } from '../MultiSelectField';
import { btnPrimary, btnSecondary, inputClass } from '../ui';

export type { FilterDialogData };

const NOTHING: DialogFields = {
  types: [],
  accountIds: [],
  categoryIds: [],
  projectIds: [],
  counterpartyIds: [],
  tagIds: [],
  withoutCategory: false,
  withoutProject: false,
  withoutCounterparty: false,
};

/** Раскладка в две колонки (§5.6): «Типы платежей и категории» — на всю ширину. */
const FIELD_CLASS: Record<FilterDimension, string> = { typesCategories: 'md:col-span-2', counterparties: '', projects: '', tags: '', accounts: '' };

/**
 * Поля окна «Фильтры» (§5.6 этапа 1.5) — все условия фильтра журнала, кроме периода, поиска и суммы (они в тулбаре).
 * Меняет черновик; «Готово» применяет его поверх текущего фильтра, «×» и Esc закрывают без изменений.
 */
function FilterForm(props: {
  state: JournalUrlState;
  data: FilterDialogData;
  onApply: (next: DialogFields) => void;
  /** Не передан (архивная компания) — «Сохранить фильтр» не показывается. */
  onSave?: (draft: DialogFields, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<DialogFields>(() => pickDialogFields(props.state));
  // «Сохранить фильтр»: поле названия, ошибка, запрос в пути
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setSaveError(undefined);
    try {
      await props.onSave?.(draft, name);
      props.onApply(draft);
    } catch (e) {
      setSaveError(e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onApply(draft);
      }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        {DIMENSIONS.map((d) => (
          <div key={d.dim} className={`min-w-0 ${FIELD_CLASS[d.dim]}`}>
            <MultiSelectField
              label={d.label}
              allLabel={d.allLabel}
              options={dimensionOptions(d.dim, props.data, draft)}
              selected={dimensionSelected(d.dim, draft)}
              onToggle={(key) => setDraft((current) => toggleDimension(d.dim, current, key))}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Среди типов, среди категорий, контрагентов и т. д. подходит любой из отмеченных вариантов («Аренда» или «Без категории»), а разные поля и тип с категорией действуют
        вместе: «Расход» и «Аренда» — расходы на аренду. Родительская категория включает дочерние.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary}>
          Готово
        </button>
        <button type="button" onClick={() => setDraft(NOTHING)} className="text-sm font-semibold text-muted underline hover:text-ink">
          Очистить
        </button>
        {props.onSave && (
          <button type="button" aria-expanded={naming} onClick={() => setNaming((v) => !v)} className={`${btnSecondary} ml-auto`}>
            Сохранить фильтр
          </button>
        )}
      </div>
      {naming && props.onSave && (
        <div className="mt-4 flex flex-wrap items-start gap-2 rounded-2xl bg-field/50 p-3">
          <Field label="Название фильтра" error={saveError} hint="Сохраняются условия окна, период, поиск и сумма; период — датами" className="min-w-56 flex-1">
            {(c) => (
              <input
                {...c}
                value={name}
                maxLength={100}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  // Enter сохраняет фильтр, а не применяет окно
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!saving) void save();
                  }
                }}
                className={`${inputClass} py-2`}
              />
            )}
          </Field>
          <button type="button" disabled={saving} onClick={() => void save()} className={`${btnPrimary} mt-6`}>
            Сохранить
          </button>
        </div>
      )}
    </form>
  );
}

/**
 * Окно «Фильтры» (§5.6 этапа 1.5): «×» в углу закрывает без применения, «Отмены» нет. Поля — выпадающие
 * мультивыборы в порядке Finmap; кнопки «Готово», «Очистить», «Сохранить фильтр».
 */
export function FilterDialog(props: {
  open: boolean;
  state: JournalUrlState;
  data: FilterDialogData;
  /** Только поля окна: их накладывают на текущий фильтр, а не на снимок при открытии. */
  onApply: (next: DialogFields) => void;
  onClose: () => void;
  /**
   * Сохраняет поля окна как именованный фильтр — тоже поверх текущего фильтра (applyDialogFields);
   * при успехе окно применяет черновик и закрывается.
   */
  onSave?: (draft: DialogFields, name: string) => Promise<void>;
}) {
  return (
    <Modal open={props.open} title="Фильтры" onClose={props.onClose} className="max-w-[818px]">
      <FilterForm
        state={props.state}
        data={props.data}
        onApply={(next) => {
          props.onApply(next);
          props.onClose();
        }}
        onSave={props.onSave}
      />
    </Modal>
  );
}
