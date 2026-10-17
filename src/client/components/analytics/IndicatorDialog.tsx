import { useState } from 'react';
import { indicatorDef, PART_KIND, PART_LABEL, STOCK_PART_LABEL, type IndicatorKey, type IndicatorPart, type PartConfig } from '../../../shared/report-indicators';
import { partChanged, partOptions, partSelected, togglePart, useSaveParts, type Parts } from '../../lib/indicators';
import type { CategoryTree } from '../../lib/queries';
import { Modal } from '../Modal';
import { MultiSelectField } from '../MultiSelectField';
import { btnPrimary, btnSecondary } from '../ui';

/**
 * Окно «Редактировать показатель» (§8.2): у каждой части показателя — выбор категорий (первый пункт — «Все категории
 * дохода/расхода», отдельный выбор) и у частей расходов флажок «Себестоимость склада (FIFO)». «Сохранить» отправляет
 * изменённые части, «Вернуть по умолчанию» — удаляет настройки частей показателя, «Отмена», «×» и Esc закрывают без
 * изменений. «Выручка» общая у всех показателей — окно говорит об этом.
 */
function IndicatorForm(props: { companyId: number; indicator: IndicatorKey; parts: Parts; categories: CategoryTree; onDone: () => void }) {
  const def = indicatorDef(props.indicator);
  const [draft, setDraft] = useState<Record<IndicatorPart, PartConfig>>(() => ({ ...props.parts }));
  const save = useSaveParts(props.companyId);
  const custom = def.parts.some((p) => !props.parts[p].isDefault);
  const submit = (changes: Parameters<typeof save.mutate>[0]) => save.mutate(changes, { onSuccess: props.onDone });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (save.isPending) return;
        submit(def.parts.filter((p) => partChanged(props.parts[p], draft[p])).map((p) => ({ part: p, config: draft[p] })));
      }}
    >
      <p className="mb-3 text-sm text-muted">Укажите категории, из которых складывается показатель.</p>
      <p className="mb-4 rounded-xl bg-field px-4 py-3 font-semibold">{def.label}</p>
      {def.parts.map((part) => (
        <fieldset key={part} className="mb-4 min-w-0">
          <legend className={`mb-2 inline-block rounded-full px-3 py-1 text-sm font-semibold ${PART_KIND[part] === 'income' ? 'bg-income-soft text-income-strong' : 'bg-expense-soft text-expense-strong'}`}>
            {PART_LABEL[part]}
          </legend>
          <MultiSelectField
            label={PART_KIND[part] === 'income' ? 'Категории дохода' : 'Категории расхода'}
            allLabel="Категорий нет"
            options={partOptions(part, props.categories, draft[part].categoryIds)}
            selected={partSelected(draft[part])}
            onToggle={(key) => setDraft((d) => ({ ...d, [part]: togglePart(d[part], key) }))}
          />
          {PART_KIND[part] === 'expense' && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft[part].includeStock}
                onChange={(e) => setDraft((d) => ({ ...d, [part]: { ...d[part], includeStock: e.target.checked } }))}
                className="size-4 accent-income"
              />
              {STOCK_PART_LABEL}
            </label>
          )}
        </fieldset>
      ))}
      <p className="mb-4 text-xs text-muted">
        «Выручка» — общая для всех показателей. Подкатегории входят с родителем. Новая категория попадает в часть сама, только если выбрано «Все категории».
      </p>
      {save.error && (
        <p role="alert" className="mb-3 text-sm text-expense-strong">
          {save.error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={btnPrimary} aria-disabled={save.isPending || undefined}>
          Сохранить
        </button>
        <button type="button" onClick={props.onDone} className={btnSecondary}>
          Отмена
        </button>
        {custom && (
          <button
            type="button"
            onClick={() => submit(def.parts.filter((p) => !props.parts[p].isDefault).map((p) => ({ part: p, config: null })))}
            className="text-sm font-semibold text-muted underline hover:text-ink"
          >
            Вернуть по умолчанию
          </button>
        )}
      </div>
    </form>
  );
}

export function IndicatorDialog(props: { companyId: number; indicator: IndicatorKey | null; parts: Parts; categories: CategoryTree; onClose: () => void }) {
  return (
    <Modal open={props.indicator !== null} title="Редактировать показатель" onClose={props.onClose} className="max-w-[560px]">
      {props.indicator && <IndicatorForm key={props.indicator} companyId={props.companyId} indicator={props.indicator} parts={props.parts} categories={props.categories} onDone={props.onClose} />}
    </Modal>
  );
}
