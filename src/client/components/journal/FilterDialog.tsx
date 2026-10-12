import { useId, useState } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { ApiError } from '../../lib/api';
import {
  applyFilterDraft,
  clearFilterDraft,
  filterDraftFrom,
  phoneMoreSet,
  pickPhoneFilterFields,
  SORT_CHOICES,
  type FilterDraft,
  type JournalUrlState,
} from '../../lib/journal-filter';
import { DIMENSIONS, dimensionOptions, dimensionSelected, toggleDimension, type FilterDialogData, type FilterDimension } from '../../lib/journal-filter-dialog';
import { Field } from '../Field';
import { ChevronIcon } from '../icons';
import { Modal } from '../Modal';
import { MultiSelectField } from '../MultiSelectField';
import { btnPrimary, btnSecondary, btnSmall, inputClass, phoneFullScreenModal } from '../ui';
import { AmountRange } from './AmountRange';
import { PeriodMenu } from './PeriodMenu';

export type { FilterDialogData };

const compactInput = inputClass.replace('py-3', 'py-2');

/** Раскладка в две колонки (§5.6): «Типы платежей и категории» — на всю ширину. */
const FIELD_CLASS: Record<FilterDimension, string> = { typesCategories: 'md:col-span-2', counterparties: '', projects: '', tags: '', accounts: '' };

/**
 * «Ещё условия» окна «Фильтры» на телефоне (§8.5 этапа 1.5): сумма от и до, сортировка и «Выгрузить в Excel» — всё по
 * черновику окна (view — черновик поверх текущего фильтра). Сворачивается кнопкой с aria-expanded.
 */
function PhoneMore(props: {
  view: JournalUrlState;
  onChange: (next: JournalUrlState) => void;
  baseCurrency: string;
  exportHref?: (state: JournalUrlState) => string;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(props.initiallyOpen);
  const id = useId();
  const currency = getCurrency(props.baseCurrency);
  return (
    <div className="mt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-1 text-sm font-semibold text-ink hover:bg-field/60 focus-visible:outline-2 focus-visible:outline-focus"
      >
        Ещё условия
        <ChevronIcon up={open} />
      </button>
      {open && (
        <div id={id} className="mt-2 flex flex-col gap-4">
          <div>
            <p className="mb-1 text-sm text-muted">Сумма, {currency.symbol}</p>
            <AmountRange state={props.view} onChange={props.onChange} minorUnits={currency.minorUnits} />
          </div>
          <Field label="Сортировка" className="w-56">
            {(c) => (
              <select
                {...c}
                value={`${props.view.sort}:${props.view.order}`}
                onChange={(e) => {
                  const choice = SORT_CHOICES.find((s) => `${s.sort}:${s.order}` === e.target.value);
                  if (choice) props.onChange({ ...props.view, sort: choice.sort, order: choice.order });
                }}
                className={compactInput}
              >
                {SORT_CHOICES.map((s) => (
                  <option key={`${s.sort}:${s.order}`} value={`${s.sort}:${s.order}`}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {props.exportHref && (
            <a href={props.exportHref(props.view)} download className={`${btnSmall} self-start`}>
              Выгрузить в Excel
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Поля окна «Фильтры» (§5.6, §8.5 этапа 1.5). Черновик — условия окна, а если окно открыли на телефоне, ещё период
 * (первым полем), сумма и сортировка (блок «Ещё условия»). «Готово» применяет черновик поверх текущего фильтра,
 * «×» и Esc закрывают без изменений. Режим телефона запоминается при открытии.
 */
function FilterForm(props: {
  state: JournalUrlState;
  data: FilterDialogData;
  phone: boolean;
  today: string;
  baseCurrency: string;
  exportHref?: (state: JournalUrlState) => string;
  onApply: (draft: FilterDraft) => void;
  /** Не передан (архивная компания) — «Сохранить фильтр» не показывается. */
  onSave?: (draft: FilterDraft, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<FilterDraft>(() => filterDraftFrom(props.state, props.phone));
  // «Сохранить фильтр»: поле названия, ошибка, запрос в пути
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  // черновик поверх текущего фильтра — для меню периода, сумм, сортировки и ссылки выгрузки
  const view = applyFilterDraft(props.state, draft);
  const setPhone = (next: JournalUrlState) => setDraft((d) => ({ ...d, phone: pickPhoneFilterFields(next) }));

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
      {draft.phone && (
        <div className="mb-3">
          <PeriodMenu state={view} today={props.today} onChange={setPhone} wide />
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
        {DIMENSIONS.map((d) => (
          <div key={d.dim} className={`min-w-0 ${FIELD_CLASS[d.dim]}`}>
            <MultiSelectField
              label={d.label}
              allLabel={d.allLabel}
              options={dimensionOptions(d.dim, props.data, draft.fields)}
              selected={dimensionSelected(d.dim, draft.fields)}
              onToggle={(key) => setDraft((current) => ({ ...current, fields: toggleDimension(d.dim, current.fields, key) }))}
            />
          </div>
        ))}
      </div>
      {draft.phone && (
        <PhoneMore view={view} onChange={setPhone} baseCurrency={props.baseCurrency} exportHref={props.exportHref} initiallyOpen={phoneMoreSet(draft.phone)} />
      )}
      <p className="mt-3 text-xs text-muted">
        Среди типов, среди категорий, контрагентов и т. д. подходит любой из отмеченных вариантов («Аренда» или «Без категории»), а разные поля и тип с категорией действуют
        вместе: «Расход» и «Аренда» — расходы на аренду. Родительская категория включает дочерние.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary}>
          Готово
        </button>
        <button type="button" onClick={() => setDraft(clearFilterDraft)} className="text-sm font-semibold text-muted underline hover:text-ink">
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
 * Окно «Фильтры» (§5.6, §8.5 этапа 1.5): «×» в углу закрывает без применения, «Отмены» нет. Поля — выпадающие
 * мультивыборы в порядке Finmap; кнопки «Готово», «Очистить», «Сохранить фильтр». На телефоне — на весь экран,
 * с «Периодом» первым полем и блоком «Ещё условия».
 */
export function FilterDialog(props: {
  open: boolean;
  state: JournalUrlState;
  data: FilterDialogData;
  /** Окно открыто на телефоне: в черновике ещё период, сумма и сортировка. */
  phone: boolean;
  today: string;
  baseCurrency: string;
  /** Ссылка «Выгрузить в Excel» по фильтру (на телефоне — в «Ещё условия»). */
  exportHref?: (state: JournalUrlState) => string;
  /** Черновик окна: его накладывают на текущий фильтр (`applyFilterDraft`), а не на снимок при открытии. */
  onApply: (draft: FilterDraft) => void;
  onClose: () => void;
  /** Сохраняет черновик как именованный фильтр — тоже поверх текущего фильтра; при успехе окно применяет черновик и закрывается. */
  onSave?: (draft: FilterDraft, name: string) => Promise<void>;
}) {
  return (
    <Modal open={props.open} title="Фильтры" onClose={props.onClose} className={`max-w-[818px] ${phoneFullScreenModal}`} phoneFullScreen>
      <FilterForm
        state={props.state}
        data={props.data}
        phone={props.phone}
        today={props.today}
        baseCurrency={props.baseCurrency}
        exportHref={props.exportHref}
        onApply={(next) => {
          props.onApply(next);
          props.onClose();
        }}
        onSave={props.onSave}
      />
    </Modal>
  );
}
