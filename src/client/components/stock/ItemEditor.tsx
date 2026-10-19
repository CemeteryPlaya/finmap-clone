import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { STOCK_BARCODE_MAX, STOCK_ITEM_NAME_MAX } from '../../../shared/schemas/stock';
import { STOCK_UNITS, UNIT_LABELS, type StockUnit } from '../../../shared/stock-qty';
import { api, type ApiError } from '../../lib/api';
import { invalidateStock, type StockGroup, type StockItem } from '../../lib/stock';
import { emptyItemForm, itemBody, itemFormOf, newPartDraft, type ItemForm, type PartDraft } from '../../lib/stock-item-form';
import { useEntityActions } from '../../lib/settings-mutations';
import { useHeldWhile } from '../../lib/use-edited';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { ArchivedNote, EntityActions } from '../EntityActions';
import { Field } from '../Field';
import { alertClass, btnIcon, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';
import { NumberInput } from './NumberInput';

/**
 * Окно товара (§4.3 спецификации «Склад»): название, группа, единица, штрихкод, минимальный остаток; цену продажи у нового
 * товара — здесь, у существующего — «Изменить цену» (дата начала и новая цена, история сохраняется). Архив вместо удаления,
 * если по товару есть документы (сервер отвечает 422). Комплект (план «Склад-2») — флажок при создании и состав
 * «товар — количество»; состав меняется, пока по комплекту нет документов.
 */
export function ItemEditor(props: {
  companyId: number;
  baseCurrency: string;
  item: StockItem | null;
  gone: boolean;
  groups: StockGroup[];
  /** Каталог: составляющие комплекта и их единицы. */
  items: StockItem[];
  readOnly: boolean;
  onChangePrice: (item: StockItem) => void;
  onDone: () => void;
}) {
  const { companyId } = props;
  const minorUnits = getCurrency(props.baseCurrency).minorUnits;
  const base = `/companies/${companyId}/stock/items`;
  const fresh = props.item;
  const [form, setForm] = useState<ItemForm>(() => (fresh ? itemFormOf(fresh) : emptyItemForm()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const edit = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key)));
  };
  const refresh = () => invalidateStock(companyId);
  const save = useMutation<unknown, ApiError, Record<string, unknown>>({
    mutationFn: (body) => (fresh ? api(`${base}/${fresh.id}`, { method: 'PATCH', body }) : api(base, { method: 'POST', body })),
    onSuccess: async () => {
      await refresh();
      props.onDone();
    },
    onError: (e) => setErrors(e.fields?.salePrice ? { ...e.fields, price: e.fields.salePrice } : (e.fields ?? {})),
  });
  const actions = useEntityActions(fresh ? `${base}/${fresh.id}` : base, refresh, props.onDone);
  const busy = actions.pending || save.isPending;
  const item = useHeldWhile(fresh, busy);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = itemBody(
      form,
      minorUnits,
      !fresh,
      new Map(props.items.map((i) => [i.id, i.unit])),
    );
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    save.mutate(r.body);
  };

  if (props.gone && !busy) return <p className="text-muted">Товар не найден — возможно, его удалили.</p>;
  const unitProblem = errors.unit;
  const setPart = (key: number, patch: Partial<PartDraft>, field: 'itemId' | 'qty') => {
    const index = form.parts.findIndex((p) => p.key === key);
    setForm((f) => ({ ...f, parts: f.parts.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
    // смена товара меняет и единицу: прежняя ошибка количества уже не про эту строку
    const cleared = field === 'itemId' ? [`parts.${index}.itemId`, `parts.${index}.qty`] : [`parts.${index}.qty`];
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !cleared.includes(k) && k !== 'parts')));
  };
  // составляющие — товары, не комплекты; архивные — только уже выбранные
  const partOptions = (selected: number | null) => props.items.filter((i) => !i.isCombo && i.id !== fresh?.id && (!i.archivedAt || i.id === selected));
  const unitOf = new Map(props.items.map((i) => [i.id, i.unit]));
  const nameOf = new Map(props.items.map((i) => [i.id, i.name]));
  return (
    <>
      {item?.archivedAt ? (
        <ArchivedNote />
      ) : (
        <form noValidate onSubmit={submit} aria-label="Товар" className="grid gap-4">
          <Field label="Название товара" error={errors.name}>
            {(c) => <input {...c} value={form.name} maxLength={STOCK_ITEM_NAME_MAX} onChange={(e) => edit('name', e.target.value)} disabled={props.readOnly} className={inputClass} />}
          </Field>
          <Field label="Группа" error={errors.groupId}>
            {(c) => (
              <select
                {...c}
                value={form.groupId ?? ''}
                disabled={props.readOnly}
                onChange={(e) => edit('groupId', e.target.value === '' ? null : Number(e.target.value))}
                className={inputClass}
              >
                <option value="">Без группы</option>
                {props.groups
                  .filter((g) => !g.archivedAt || g.id === form.groupId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.archivedAt ? ' (в архиве)' : ''}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field label="Единица" error={unitProblem}>
            {(c) => (
              <select {...c} value={form.unit} disabled={props.readOnly} onChange={(e) => edit('unit', e.target.value as StockUnit)} className={inputClass}>
                {STOCK_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {!fresh && !props.readOnly && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isCombo}
                onChange={(e) => {
                  const isCombo = e.target.checked;
                  setForm((f) => ({ ...f, isCombo, parts: isCombo && f.parts.length === 0 ? [newPartDraft()] : f.parts }));
                  setErrors((er) => Object.fromEntries(Object.entries(er).filter(([k]) => !k.startsWith('parts') && k !== 'unit')));
                }}
              />
              Комплект — продаётся набором, списывает свои составляющие
            </label>
          )}
          {form.isCombo && (
            <fieldset className="grid gap-2 rounded-xl border border-field p-3">
              <legend className="px-1 text-sm font-semibold">Состав комплекта</legend>
              {form.partsLocked || props.readOnly ? (
                <>
                  <ul className="text-sm">
                    {form.parts.map((p) => (
                      <li key={p.key}>
                        {(p.itemId !== null && nameOf.get(p.itemId)) || '…'} × {p.qty} {p.itemId !== null ? UNIT_LABELS[unitOf.get(p.itemId) ?? 'pcs'] : ''}
                      </li>
                    ))}
                  </ul>
                  {form.partsLocked && <p className="text-xs text-muted">По комплекту есть документы — состав изменить нельзя. Новый состав — новый комплект.</p>}
                </>
              ) : (
                <>
                  {form.parts.map((p, i) => (
                    <div key={p.key} role="group" aria-label={`Составляющая ${i + 1}`} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-start gap-2">
                      <Field label="Товар" error={errors[`parts.${i}.itemId`]}>
                        {(c) => (
                          <select {...c} value={p.itemId ?? ''} onChange={(e) => setPart(p.key, { itemId: e.target.value === '' ? null : Number(e.target.value) }, 'itemId')} className={inputClass}>
                            <option value="">Выберите товар</option>
                            {partOptions(p.itemId).map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                      <Field label={`Кол-во, ${UNIT_LABELS[(p.itemId !== null && unitOf.get(p.itemId)) || 'pcs']}`} error={errors[`parts.${i}.qty`]}>
                        {(c) => <NumberInput {...c} value={p.qty} onChange={(t) => setPart(p.key, { qty: t }, 'qty')} className={inputClass} />}
                      </Field>
                      <button
                        type="button"
                        aria-label={`Убрать составляющую ${i + 1}`}
                        title="Убрать составляющую"
                        onClick={() => {
                          // ошибки состава — по номеру строки: после удаления номера сдвигаются
                          setForm((f) => ({ ...f, parts: f.parts.filter((x) => x.key !== p.key) }));
                          setErrors((er) => Object.fromEntries(Object.entries(er).filter(([k]) => !k.startsWith('parts'))));
                        }}
                        className={`${btnIcon} mt-7`}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </div>
                  ))}
                  {errors.parts && (
                    <p role="alert" className="text-sm text-expense-strong">
                      {errors.parts}
                    </p>
                  )}
                  <button type="button" onClick={() => setForm((f) => ({ ...f, parts: [...f.parts, newPartDraft()] }))} className={`${btnSmall} justify-self-start`}>
                    + Составляющая
                  </button>
                </>
              )}
            </fieldset>
          )}
          <Field label="Штрихкод" error={errors.barcode}>
            {(c) => <input {...c} value={form.barcode} maxLength={STOCK_BARCODE_MAX} onChange={(e) => edit('barcode', e.target.value)} disabled={props.readOnly} className={inputClass} />}
          </Field>
          {fresh ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-field px-4 py-3 text-sm">
              <span>
                Цена продажи: <strong className="tabular-nums">{formatMoney(fresh.salePrice, props.baseCurrency, MONEY_SCREEN)}</strong>
              </span>
              {!props.readOnly && !fresh.archivedAt && (
                <button type="button" onClick={() => props.onChangePrice(fresh)} className={btnSmall}>
                  Изменить цену
                </button>
              )}
            </div>
          ) : (
            <Field label={`Цена продажи, ${getCurrency(props.baseCurrency).symbol}`} error={errors.price} hint="Можно изменить позже: история цены сохранится">
              {(c) => <NumberInput {...c} value={form.price} onChange={(t) => edit('price', t)} className={inputClass} />}
            </Field>
          )}
          <Field label={`Минимальный остаток, ${UNIT_LABELS[form.unit]}`} error={errors.minQty} hint="Ниже этого остатка в «Остатках» будет пометка «Мало»">
            {(c) => <NumberInput {...c} value={form.minQty} onChange={(t) => edit('minQty', t)} disabled={props.readOnly} className={inputClass} />}
          </Field>
          {save.error && !save.error.fields && (
            <p role="alert" className={`${alertClass} mb-0`}>
              {save.error.message}
            </p>
          )}
          {!props.readOnly && (
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={save.isPending} className={btnPrimary}>
                Сохранить
              </button>
              <button type="button" onClick={props.onDone} className={btnSecondary}>
                Отмена
              </button>
            </div>
          )}
        </form>
      )}
      {item && !props.readOnly && (
        <EntityActions
          archived={item.archivedAt !== null}
          onArchiveToggle={() => actions.toggleArchive(item.archivedAt !== null)}
          what={`товар «${item.name}»`}
          onDelete={actions.remove}
          pending={actions.pending}
          error={actions.error}
        />
      )}
    </>
  );
}
