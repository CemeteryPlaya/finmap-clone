import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { getCurrency } from '../../../shared/currencies';
import { formatDateRu, todayInTimezone } from '../../../shared/dates';
import { formatMoney, MONEY_SCREEN } from '../../../shared/money';
import { WRITEOFF_REASON_LABELS, WRITEOFF_REASONS, type StockDocType, type WriteoffReason } from '../../../shared/schemas/stock';
import { UNIT_LABELS } from '../../../shared/stock-qty';
import { api, ApiError } from '../../lib/api';
import { amountInputText, dayOf } from '../../lib/journal-format';
import { createFromForm } from '../../lib/operation-create';
import { shownPaidTime } from '../../lib/operation-form';
import { counterpartyOptions } from '../../lib/operation-options';
import { useCounterparties, type Company, type Counterparty } from '../../lib/queries';
import { useMeta } from '../../lib/query';
import {
  buildDocBody,
  docSubmitLabel,
  docTitle,
  draftFromDoc,
  draftTotal,
  emptyDocDraft,
  impactText,
  newDocLine,
  paymentSummary,
  repriceSaleLines,
  setLineAmount,
  setLineItem,
  setLinePrice,
  mapServerLineErrors,
  setLineQty,
  DOC_COMMENT_MAX,
  type DocBody,
  type DocDraft,
  type DocLineDraft,
  type ItemInfo,
} from '../../lib/stock-doc-form';
import { invalidateStock, useStockItems, useStockWarehouses, type DocImpact, type StockDoc, type StockItem, type StockWarehouse, type Unpaid } from '../../lib/stock';
import { useNow } from '../../lib/use-now';
import { ConfirmDialog } from '../ConfirmDialog';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { ComboSelect } from '../operation/ComboSelect';
import { useOpenOperationForm } from '../operation/OperationFormHost';
import { DateTimeField } from '../operation/DateTimeField';
import { Pending } from '../QueryState';
import { alertClass, btnDanger, btnIcon, btnSecondary, btnSmall, floatingControlClass, floatingTextareaClass, noticeClass, phoneFullScreenModal } from '../ui';
import { NumberInput } from './NumberInput';
import { PostToJournal } from './PostToJournal';

/** Что открыть: новый документ типа или существующий по id. */
export type DocFormRequest = { kind: 'create'; type: StockDocType; warehouse: number | null } | { kind: 'edit'; id: number };

const MODAL_CLASS = `max-w-3xl ${phoneFullScreenModal}`;

interface SaveResult {
  doc: StockDoc | null;
  impact: DocImpact;
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка сервера');

/**
 * Форма документа «Поступление», «Продажа», «Списание» (§4.2 спецификации «Склад»): дата и время, склад, поставщик или
 * покупатель, причина списания; строки «товар, количество, цена, сумма» (цена и сумма связаны); итог. Перед записью
 * сервер считает последствия (`dryRun`): если изменится себестоимость уже проведённых продаж — окно предупреждает (§5.4).
 */
export function DocForm(props: { company: Company; request: DocFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const editId = props.request.kind === 'edit' ? props.request.id : null;
  const doc = useQuery<StockDoc, ApiError>({
    queryKey: ['stock', props.company.id, 'doc', editId],
    queryFn: async () => (await api<{ doc: StockDoc }>(`/companies/${props.company.id}/stock/docs/${editId}`)).doc,
    enabled: editId !== null,
    gcTime: 0,
  });
  const meta = useMeta();
  const items = useStockItems(props.company.id);
  const warehouses = useStockWarehouses(props.company.id);
  const counterparties = useCounterparties(props.company.id);
  const cancel = useRef<() => void>(() => setOpen(false));
  const type = props.request.kind === 'create' ? props.request.type : doc.data?.type;
  const ready = meta.data && items.data && warehouses.data && counterparties.data && (editId === null || doc.data);

  return (
    <Modal open={open} title={type ? docTitle(type, doc.data?.number ?? null) : 'Документ'} onClose={props.onClose} onCancel={() => cancel.current()} className={MODAL_CLASS} phoneFullScreen>
      {ready && type ? (
        <DocEditor
          company={props.company}
          timeZone={meta.data.timezone}
          items={items.data}
          warehouses={warehouses.data}
          counterparties={counterparties.data}
          type={type}
          initialWarehouse={props.request.kind === 'create' ? props.request.warehouse : null}
          doc={doc.data ?? null}
          close={() => setOpen(false)}
          cancelRef={cancel}
        />
      ) : (
        <Pending queries={[meta, items, warehouses, counterparties, ...(editId !== null ? [doc] : [])]} />
      )}
    </Modal>
  );
}

function DocEditor(p: {
  company: Company;
  timeZone: string;
  items: StockItem[];
  warehouses: StockWarehouse[];
  counterparties: Counterparty[];
  type: StockDocType;
  initialWarehouse: number | null;
  /** Правка существующего документа; null — новый. */
  doc: StockDoc | null;
  close: () => void;
  cancelRef: MutableRefObject<() => void>;
}) {
  const currency = getCurrency(p.company.baseCurrency);
  const clock = useNow(p.timeZone);
  const readOnly = p.company.archivedAt !== null;
  const itemInfo = new Map<number, ItemInfo>(p.items.map((i) => [i.id, { id: i.id, unit: i.unit, prices: i.prices }]));
  const itemById = new Map(p.items.map((i) => [i.id, i]));
  const [doc, setDoc] = useState(p.doc);
  const [initial, setInitial] = useState<DocDraft>(() => {
    if (p.doc) return draftFromDoc(p.doc, itemInfo, p.company.baseCurrency, p.timeZone);
    const active = p.warehouses.filter((w) => !w.archivedAt);
    const warehouseId = p.initialWarehouse ?? (active.length === 1 ? active[0]!.id : null);
    return emptyDocDraft(p.type, todayInTimezone(p.timeZone), warehouseId);
  });
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Счётчик ошибок проверки: после каждой фокус уходит на первое неверное поле (R18). */
  const [errorFocus, setErrorFocus] = useState(0);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  /** Вопрос о последствиях правки (§5.4): текст и действие «Сохранить» / «Удалить». */
  const [ask, setAsk] = useState<{ title: string; text: string; confirm: string; danger: boolean; run: () => Promise<void> } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  /** Окно «Провести в журнал» у продажи (§6.3). */
  const [posting, setPosting] = useState(false);
  const openOperation = useOpenOperationForm();
  const formRef = useRef<HTMLFormElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  /** Куда перевести фокус после следующей отрисовки: «Товар» строки по её номеру-ключу или «+ Добавить строку» (R6). */
  const focusNext = useRef<{ line: number } | 'add' | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    if (target === 'add') addRef.current?.focus();
    else formRef.current?.querySelector<HTMLElement>(`[data-line-key="${target.line}"] [role="combobox"]`)?.focus();
  });
  useEffect(() => {
    if (!errorFocus) return;
    const form = formRef.current;
    const target = form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? addRef.current;
    target?.focus();
  }, [errorFocus]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const type = p.type;
  const base = `/companies/${p.company.id}/stock/docs`;
  const docDay = draft.paidDateSet ? draft.paidDate : clock.today;

  p.cancelRef.current = () => {
    if (pending) return;
    if (dirty && !readOnly) setConfirmClose(true);
    else p.close();
  };

  const set = (patch: Partial<DocDraft>, ...errorKeys: string[]) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !errorKeys.includes(k) && !errorKeys.some((x) => k.startsWith(`${x}.`)))));
  };
  const setLine = (key: number, fn: (l: DocLineDraft) => DocLineDraft, ...errorKeys: string[]) => {
    setDraft((d) => ({ ...d, lines: d.lines.map((l) => (l.key === key ? fn(l) : l)) }));
    setErrors((e) => {
      const index = draft.lines.findIndex((l) => l.key === key);
      return Object.fromEntries(Object.entries(e).filter(([k]) => !errorKeys.some((x) => k === `lines.${index}.${x}`) && k !== 'lines'));
    });
  };

  /** Тело запроса из черновика; ошибки — на поля. */
  const body = (): DocBody | null => {
    const now = new Date();
    const r = buildDocBody(draft, {
      items: itemInfo,
      currency: p.company.baseCurrency,
      today: todayInTimezone(p.timeZone, now),
      timeZone: p.timeZone,
      now,
      timeOfDayFrom: doc ? new Date(doc.at) : now,
      originalAt: doc?.at,
    });
    if (!r.ok) {
      setErrors(r.errors);
      setFormError('Проверьте заполнение полей');
      setErrorFocus((n) => n + 1);
      return null;
    }
    return r.body;
  };

  const failed = (e: unknown) => {
    if (e instanceof ApiError && e.status === 409 && doc) {
      setConflict(true);
      return;
    }
    setErrors(e instanceof ApiError ? mapServerLineErrors(e.fields ?? {}, draft.lines) : {});
    setFormError(errorText(e));
    setErrorFocus((n) => n + 1);
  };

  /** Запись документа: создание или правка (в правке уходят все поля — сервер сам отбросит неизменённое). */
  const write = async (b: DocBody, dryRun: boolean): Promise<SaveResult> => {
    if (doc) {
      const { type: _type, ...fields } = b;
      return api<SaveResult>(`${base}/${doc.id}`, { method: 'PATCH', body: { version: doc.version, ...fields, dryRun } });
    }
    return api<SaveResult>(base, { method: 'POST', body: { ...b, dryRun } });
  };

  const commit = async (b: DocBody) => {
    setPending(true);
    try {
      await write(b, false);
      await invalidateStock(p.company.id);
      p.close();
    } catch (e) {
      failed(e);
    } finally {
      setPending(false);
      setAsk(null);
    }
  };

  const submit = async () => {
    if (pending || readOnly) return;
    setFormError(null);
    const b = body();
    if (!b) return;
    setPending(true);
    try {
      const dry = await write(b, true);
      const text = impactText(dry.impact, p.timeZone);
      if (text) {
        setAsk({ title: 'Изменится себестоимость', text, confirm: 'Сохранить', danger: false, run: () => commit(b) });
        return;
      }
    } catch (e) {
      failed(e);
      return;
    } finally {
      setPending(false);
    }
    await commit(b);
  };

  const askDelete = async () => {
    if (!doc || pending) return;
    setFormError(null);
    setPending(true);
    try {
      const dry = await api<SaveResult>(`${base}/${doc.id}?dryRun=1`, { method: 'DELETE' });
      const text = impactText(dry.impact, p.timeZone);
      setAsk({
        title: 'Удалить документ?',
        text: text ?? 'Остатки и себестоимость будут пересчитаны так, будто документа не было.',
        confirm: 'Удалить',
        danger: true,
        run: async () => {
          setPending(true);
          try {
            await api(`${base}/${doc.id}`, { method: 'DELETE' });
            await invalidateStock(p.company.id);
            p.close();
          } catch (e) {
            failed(e);
          } finally {
            setPending(false);
            setAsk(null);
          }
        },
      });
    } catch (e) {
      failed(e);
    } finally {
      setPending(false);
    }
  };

  const reload = async () => {
    if (!doc) return;
    setPending(true);
    try {
      const fresh = (await api<{ doc: StockDoc }>(`${base}/${doc.id}`)).doc;
      const next = draftFromDoc(fresh, itemInfo, p.company.baseCurrency, p.timeZone);
      setDoc(fresh);
      setDraft(next);
      setInitial(next);
      setConflict(false);
      setErrors({});
      setFormError(null);
    } catch (e) {
      setFormError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  /** Обновить документ с сервера, не трогая правки формы: изменились оплаты или проведение. */
  const refreshDoc = async () => {
    if (!doc) return;
    try {
      setDoc((await api<{ doc: StockDoc }>(`${base}/${doc.id}`)).doc);
    } catch {
      /* данные обновятся при следующем открытии */
    }
  };

  /** «Оплатить» (§6.1): расход с поставщиком, суммой — долгом документа — и отмеченным документом; категория — прошлая для поставщика. */
  const pay = async () => {
    if (!doc || pending || doc.counterpartyId === null) return;
    const debt = doc.total - doc.paid;
    setPending(true);
    try {
      const unpaid = await api<Unpaid>(`/companies/${p.company.id}/stock/suppliers/${doc.counterpartyId}/unpaid`);
      const amount = amountInputText(debt, currency.minorUnits);
      p.close();
      openOperation({
        kind: 'create',
        type: 'expense',
        prefill: { counterpartyId: doc.counterpartyId, amount, categoryId: unpaid.lastCategoryId, stockPayments: [{ docId: doc.id, amount }] },
      });
    } catch (e) {
      failed(e);
    } finally {
      setPending(false);
    }
  };

  const createItem = async (name: string, key: number): Promise<boolean> => {
    setFormError(null);
    try {
      const created = (await api<{ item: StockItem }>(`/companies/${p.company.id}/stock/items`, { method: 'POST', body: { name, unit: 'pcs' } })).item;
      await invalidateStock(p.company.id);
      setLine(key, (l) => setLineItem(l, created.id, { id: created.id, unit: created.unit, prices: created.prices }, type, docDay, p.company.baseCurrency), 'itemId');
      return true;
    } catch (e) {
      setFormError(`Не удалось создать «${name}»: ${e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера'}`);
      return false;
    }
  };
  const createCounterparty = async (name: string): Promise<boolean> => {
    setFormError(null);
    try {
      const id = await createFromForm(p.company.id, 'counterparty', name, { kind: 'expense', counterpartyType: type === 'receipt' ? 'supplier' : 'client' });
      set({ counterpartyId: id }, 'counterpartyId');
      return true;
    } catch (e) {
      setFormError(`Не удалось создать «${name}»: ${e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера'}`);
      return false;
    }
  };

  const total = draftTotal(draft, p.company.baseCurrency);
  const money = (minor: number) => formatMoney(minor, p.company.baseCurrency, MONEY_SCREEN);
  const hasAmounts = type !== 'writeoff';
  /** Подсказку про единицу показываем только у первой строки без товара, чтобы она не повторялась (R16). */
  const firstEmptyKey = draft.lines.find((l) => l.itemId === null)?.key;
  const usedItems = new Set(doc?.lines.map((l) => l.itemId) ?? []);
  const itemOptions = (selected: number | null) =>
    p.items.filter((i) => !i.archivedAt || i.id === selected || usedItems.has(i.id)).map((i) => ({ id: i.id, label: i.name, suffix: UNIT_LABELS[i.unit] }));
  const warehouseOptions = p.warehouses.filter((w) => !w.archivedAt || w.id === draft.warehouseId);
  const counterpartyLabel = type === 'receipt' ? 'Поставщик' : 'Покупатель';
  const preferred = type === 'receipt' ? 'supplier' : 'client';
  const originalDay = doc ? dayOf(doc.at, p.timeZone) : null;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <>
      <form ref={formRef} noValidate onSubmit={onSubmit} aria-label="Документ склада" className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {readOnly && <p className={`${noticeClass} mb-0`}>Компания в архиве — изменения недоступны.</p>}
        {doc?.deletedAt && <p className={`${noticeClass} mb-0`}>Документ удалён.</p>}
        <fieldset disabled={pending || readOnly} className="contents">
          <div className="grid gap-4 md:grid-cols-2">
            <DateTimeField
              label="Дата и время"
              date={docDay}
              time={shownPaidTime({ paidDate: docDay, paidTime: draft.paidTime, paidTimeSet: draft.paidTimeSet }, clock.time, clock.today, originalDay)}
              nowTime={clock.time}
              today={clock.today}
              originalDate={originalDay}
              editing={doc !== null}
              error={errors.at}
              onDateChange={(picked) =>
                !draft.paidDateSet && picked === clock.today
                  ? undefined
                  : set({ paidDate: picked, paidDateSet: true, ...(type === 'sale' ? { lines: repriceSaleLines(draft.lines, itemInfo, picked, p.company.baseCurrency) } : {}) }, 'at')
              }
              onTimeChange={(paidTime) => set({ paidTime, paidTimeSet: true, paidDate: docDay, paidDateSet: true }, 'at')}
            />
            <Field label="Склад" error={errors.warehouseId} floating filled={draft.warehouseId !== null}>
              {(c) => (
                <select
                  {...c}
                  value={draft.warehouseId ?? ''}
                  onChange={(e) => set({ warehouseId: e.target.value === '' ? null : Number(e.target.value) }, 'warehouseId')}
                  className={floatingControlClass}
                >
                  <option value="" disabled hidden />
                  {warehouseOptions.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {type === 'writeoff' ? (
            <Field label="Причина списания" error={errors.reason} floating filled>
              {(c) => (
                <select {...c} value={draft.reason ?? ''} onChange={(e) => set({ reason: e.target.value as WriteoffReason }, 'reason')} className={floatingControlClass}>
                  {WRITEOFF_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {WRITEOFF_REASON_LABELS[r]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <ComboSelect
              label={counterpartyLabel}
              listLabel="Контрагенты"
              value={draft.counterpartyId}
              options={counterpartyOptions(p.counterparties, draft.counterpartyId, preferred)}
              emptyLabel={type === 'receipt' ? 'Без поставщика' : 'Без покупателя'}
              onChange={(counterpartyId) => set({ counterpartyId }, 'counterpartyId')}
              onCreate={createCounterparty}
              createNoun={type === 'receipt' ? 'поставщика' : 'покупателя'}
              error={errors.counterpartyId}
            />
          )}

          <div className="grid gap-3" aria-label="Строки документа" role="group">
            {draft.lines.map((l, index) => {
              const item = l.itemId === null ? undefined : itemById.get(l.itemId);
              const unit = item?.unit ?? 'pcs';
              const key = (field: string) => errors[`lines.${index}.${field}`];
              return (
                <div key={l.key} data-line-key={l.key} role="group" aria-label={`Строка ${index + 1}`} className={`grid items-start gap-3 rounded-xl border border-field p-3 ${hasAmounts ? 'md:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_repeat(2,minmax(7rem,1fr))_auto]' : 'md:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_auto]'}`}>
                  <ComboSelect
                    label="Товар"
                    listLabel="Товары"
                    value={l.itemId}
                    options={itemOptions(l.itemId)}
                    emptyLabel={null}
                    onChange={(id) => setLine(l.key, (x) => setLineItem(x, id, id === null ? undefined : itemInfo.get(id), type, docDay, p.company.baseCurrency), 'itemId')}
                    onCreate={(name) => createItem(name, l.key)}
                    createNoun="товар"
                    hint={l.itemId === null && l.key === firstEmptyKey ? 'Единица — шт; другие единицы задайте в «Товарах» заранее' : undefined}
                    error={key('itemId')}
                  />
                  <Field label={`Кол-во, ${UNIT_LABELS[unit]}`} error={key('qty')} floating filled={l.qty !== ''}>
                    {(c) => <NumberInput {...c} aria-label={`Количество, ${UNIT_LABELS[unit]}`} value={l.qty} onChange={(t) => setLine(l.key, (x) => setLineQty(x, t, unit, p.company.baseCurrency), 'qty')} className={floatingControlClass} />}
                  </Field>
                  {hasAmounts && (
                    <>
                      <Field label={`Цена, ${currency.symbol}`} floating filled={l.price !== ''}>
                        {(c) => <NumberInput {...c} value={l.price} onChange={(t) => setLine(l.key, (x) => setLinePrice(x, t, unit, p.company.baseCurrency), 'amount')} className={floatingControlClass} />}
                      </Field>
                      <Field label={`Сумма, ${currency.symbol}`} error={key('amount')} floating filled={l.amount !== ''}>
                        {(c) => <NumberInput {...c} value={l.amount} onChange={(t) => setLine(l.key, (x) => setLineAmount(x, t, unit, p.company.baseCurrency), 'amount')} className={floatingControlClass} />}
                      </Field>
                    </>
                  )}
                  {draft.lines.length > 1 && !readOnly && (
                    <button
                      type="button"
                      aria-label={`Убрать строку ${index + 1}`}
                      title="Убрать строку"
                      onClick={() => {
                        const following = draft.lines[index + 1];
                        focusNext.current = following ? { line: following.key } : 'add';
                        set({ lines: draft.lines.filter((x) => x.key !== l.key) }, 'lines');
                      }}
                      className={`${btnIcon} mt-3`}
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  )}
                </div>
              );
            })}
            {errors.lines && (
              <p role="alert" className="text-sm text-expense-strong">
                {errors.lines}
              </p>
            )}
            {!readOnly && (
              <button
                ref={addRef}
                type="button"
                onClick={() => {
                  const added = newDocLine();
                  focusNext.current = { line: added.key };
                  set({ lines: [...draft.lines, added] });
                }}
                className={`${btnSecondary} justify-self-start`}
              >
                + Добавить строку
              </button>
            )}
          </div>

          {hasAmounts && (
            <p className="text-right text-lg">
              <span className="text-muted">Итого:</span> <strong className="tabular-nums">{money(total)}</strong>
            </p>
          )}
          <Field label="Комментарий" error={errors.comment} floating filled={draft.comment !== ''}>
            {(c) => <textarea {...c} rows={2} maxLength={DOC_COMMENT_MAX} value={draft.comment} onChange={(e) => set({ comment: e.target.value }, 'comment')} className={floatingTextareaClass} />}
          </Field>
        </fieldset>

        {doc && !doc.deletedAt && type === 'receipt' && (
          <section aria-label="Оплата" className="grid gap-2 rounded-xl bg-field px-4 py-3 text-sm">
            <p className="font-medium">{paymentSummary(doc.total, doc.paid, p.company.baseCurrency)}</p>
            {doc.payments.length > 0 && (
              <ul aria-label="Оплаты" className="text-muted">
                {doc.payments.map((x) => (
                  <li key={x.operationId}>
                    {formatDateRu(todayInTimezone(p.timeZone, new Date(x.paidAt)))} — {money(x.amount)}
                  </li>
                ))}
              </ul>
            )}
            {!readOnly && doc.counterpartyId !== null && doc.total - doc.paid > 0 && (
              <button
                type="button"
                aria-disabled={dirty || pending || undefined}
                aria-describedby={dirty ? 'doc-pay-reason' : undefined}
                title={dirty ? 'Сначала сохраните изменения документа' : undefined}
                onClick={() => {
                  if (!dirty) void pay();
                }}
                className={`${btnSmall} justify-self-start aria-disabled:opacity-50`}
              >
                Оплатить
              </button>
            )}
            {dirty && (
              <p id="doc-pay-reason" className="text-muted">
                Сначала сохраните изменения документа
              </p>
            )}
            {doc.counterpartyId === null && <p className="text-muted">Чтобы оплатить поступление, укажите поставщика.</p>}
          </section>
        )}
        {doc && !doc.deletedAt && type === 'sale' && (
          <section aria-label="Журнал" className="grid gap-2 rounded-xl bg-field px-4 py-3 text-sm">
            {doc.posting ? (
              <>
                <p className="font-medium">
                  Проведена в журнал: доход {money(doc.posting.amount)}
                  {doc.posting.amount !== doc.total && <span className="text-muted"> (сумма документа {money(doc.total)} — операцию журнала правьте отдельно)</span>}
                </p>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-disabled={dirty || pending || undefined}
                  aria-describedby={dirty ? 'doc-op-reason' : undefined}
                  title={dirty ? 'Сначала сохраните изменения документа' : undefined}
                  onClick={() => {
                    if (dirty || pending || !doc.posting) return;
                    const operationId = doc.posting.operationId;
                    p.close();
                    openOperation({ kind: 'edit', id: operationId });
                  }}
                  className={`${btnSmall} justify-self-start aria-disabled:opacity-50`}
                >
                  Открыть операцию
                </button>
                {dirty && (
                  <p id="doc-op-reason" className="text-muted">
                    Сначала сохраните изменения документа
                  </p>
                )}
              </>
            ) : (
              !readOnly &&
              doc.total > 0 && (
                <>
                  <button
                    type="button"
                    aria-disabled={dirty || pending || undefined}
                    aria-describedby={dirty ? 'doc-post-reason' : undefined}
                    title={dirty ? 'Сначала сохраните изменения документа' : undefined}
                    onClick={() => {
                      if (!dirty) setPosting(true);
                    }}
                    className={`${btnSmall} justify-self-start aria-disabled:opacity-50`}
                  >
                    Провести в журнал
                  </button>
                  {dirty && (
                    <p id="doc-post-reason" className="text-muted">
                      Сначала сохраните изменения документа
                    </p>
                  )}
                </>
              )
            )}
          </section>
        )}
        {conflict && (
          <div role="alert" className={`${alertClass} mb-0 flex flex-wrap items-center justify-between gap-2`}>
            <span>Документ изменён другим пользователем</span>
            <button type="button" disabled={pending} onClick={() => void reload()} className="font-semibold underline">
              Загрузить актуальный
            </button>
          </div>
        )}
        {formError && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {formError}
          </p>
        )}
        {!readOnly && !doc?.deletedAt && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="h-12 rounded-xl bg-income px-6 font-semibold text-ink hover:brightness-105 disabled:opacity-50">
              {docSubmitLabel(type, doc !== null)}
            </button>
            {doc && (
              <button type="button" disabled={pending} onClick={() => void askDelete()} className={`${btnDanger} ml-auto`}>
                Удалить документ
              </button>
            )}
          </div>
        )}
      </form>
      <Modal open={posting && doc !== null} title="Провести в журнал" onClose={() => setPosting(false)} className="max-w-md">
        {posting && doc && (
          <PostToJournal
            company={p.company}
            doc={doc}
            onDone={(posted) => {
              setPosting(false);
              if (posted) void refreshDoc();
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={ask !== null}
        title={ask?.title ?? ''}
        text={ask?.text ?? ''}
        confirmLabel={ask?.confirm ?? 'Сохранить'}
        danger={ask?.danger}
        pending={pending}
        onCancel={() => setAsk(null)}
        onConfirm={() => void ask?.run()}
      />
      <ConfirmDialog
        open={confirmClose}
        title="Ваши данные не сохранятся"
        text="Закрыть окно? Введённые данные будут потеряны."
        confirmLabel="Закрыть"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => p.close()}
      />
    </>
  );
}
