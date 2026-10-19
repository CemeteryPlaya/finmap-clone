import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { todayInTimezone } from '../../../shared/dates';
import { UNIT_LABELS, type StockUnit } from '../../../shared/stock-qty';
import { api, ApiError } from '../../lib/api';
import { paidAtFor } from '../../lib/operation-form';
import type { Company } from '../../lib/queries';
import { useMeta } from '../../lib/query';
import { invalidateStock, useStockItems, useStockWarehouses, type DocImpact, type StockDoc, type StockItem, type StockWarehouse } from '../../lib/stock';
import { countBody, countDiff, countDirty, countDraftFromDoc, countSnapshot, countSummaryText, newCountLine, type CountLineDraft } from '../../lib/stock-count';
import { impactText } from '../../lib/stock-doc-form';
import { qtyWithUnit } from '../../lib/stock-view';
import { ConfirmDialog } from '../ConfirmDialog';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { Pending } from '../QueryState';
import { alertClass, btnDanger, btnIcon, btnPrimary, btnSecondary, inputClass, noticeClass, phoneFullScreenModal } from '../ui';
import { NumberInput } from './NumberInput';

/** Что открыть: новая инвентаризация склада или существующая по id. */
export type CountFormRequest = { kind: 'create'; warehouse: number | null } | { kind: 'edit'; id: number };

const MODAL_CLASS = `max-w-3xl ${phoneFullScreenModal}`;
const thClass = 'px-2 py-2 text-left text-xs font-semibold text-muted';
const tdClass = 'px-2 py-2 align-middle';
const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Ошибка сервера');

/**
 * Инвентаризация (§7 спецификации «Склад»): склад и дата → строки «Товар — Учёт — Факт — Разница» (по умолчанию все товары
 * склада с ненулевым остатком), черновик можно сохранять в несколько заходов; «Провести» фиксирует учёт, недостача
 * списывается по FIFO, излишек приходуется — итог «Недостача на X, излишек на Y». Проведённая — только для чтения.
 */
export function CountForm(props: { company: Company; request: CountFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [docId, setDocId] = useState(props.request.kind === 'edit' ? props.request.id : null);
  const meta = useMeta();
  const items = useStockItems(props.company.id);
  const warehouses = useStockWarehouses(props.company.id);
  const doc = useQuery<StockDoc, ApiError>({
    queryKey: ['stock', props.company.id, 'doc', docId],
    queryFn: async () => (await api<{ doc: StockDoc }>(`/companies/${props.company.id}/stock/docs/${docId}`)).doc,
    enabled: docId !== null,
    gcTime: 0,
  });
  const title = docId === null ? 'Новая инвентаризация' : doc.data ? `Инвентаризация ${doc.data.number}` : 'Инвентаризация';
  const ready = meta.data && items.data && warehouses.data;
  /** Esc и «×»: окно строк спрашивает о несохранённом (§14), остальные закрываются сразу. */
  const cancel = useRef<() => void>(() => setOpen(false));

  return (
    <Modal open={open} title={title} onClose={props.onClose} onCancel={() => cancel.current()} className={MODAL_CLASS} phoneFullScreen>
      {!ready ? (
        <Pending queries={[meta, items, warehouses]} />
      ) : docId === null ? (
        <CountStart
          company={props.company}
          timeZone={meta.data.timezone}
          warehouses={warehouses.data}
          initialWarehouse={props.request.kind === 'create' ? props.request.warehouse : null}
          onStarted={setDocId}
        />
      ) : doc.data ? (
        <CountEditor
          key={doc.data.id}
          company={props.company}
          timeZone={meta.data.timezone}
          items={items.data}
          warehouses={warehouses.data}
          doc={doc.data}
          reload={() => void doc.refetch()}
          close={() => setOpen(false)}
          cancelRef={cancel}
        />
      ) : (
        <Pending queries={[doc]} />
      )}
    </Modal>
  );
}

/** Шаг 1: склад, дата и «Заполнить товарами склада». */
function CountStart(p: { company: Company; timeZone: string; warehouses: StockWarehouse[]; initialWarehouse: number | null; onStarted: (id: number) => void }) {
  const active = p.warehouses.filter((w) => !w.archivedAt);
  const today = todayInTimezone(p.timeZone);
  const [warehouseId, setWarehouseId] = useState<number | null>(p.initialWarehouse ?? (active.length === 1 ? active[0]!.id : null));
  const [date, setDate] = useState(today);
  const [fill, setFill] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (warehouseId === null) {
      setError('Выберите склад');
      return;
    }
    if (date === '' || date > today) {
      setError('Дата инвентаризации — сегодня или раньше');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const now = new Date();
      const at = paidAtFor(date, now, now, p.timeZone);
      const { doc } = await api<{ doc: StockDoc }>(`/companies/${p.company.id}/stock/docs`, { method: 'POST', body: { type: 'count', at, warehouseId, lines: [], fill } });
      await invalidateStock(p.company.id);
      p.onStarted(doc.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form noValidate onSubmit={start} aria-label="Новая инвентаризация" className="grid gap-4">
      <Field label="Склад">
        {(c) => (
          <select {...c} value={warehouseId ?? ''} onChange={(e) => setWarehouseId(e.target.value === '' ? null : Number(e.target.value))} className={inputClass}>
            <option value="">Выберите склад</option>
            {active.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Дата">
        {(c) => <input {...c} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={inputClass} />}
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
        Заполнить товарами склада (с ненулевым остатком на эту дату)
      </label>
      {error && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className={`${btnPrimary} justify-self-start`}>
        Начать инвентаризацию
      </button>
    </form>
  );
}

/** Шаг 2: строки, «Сохранить черновик», «Провести»; после проведения — итог и только чтение. */
function CountEditor(p: {
  company: Company;
  timeZone: string;
  items: StockItem[];
  warehouses: StockWarehouse[];
  doc: StockDoc;
  reload: () => void;
  close: () => void;
  cancelRef: MutableRefObject<() => void>;
}) {
  const base = `/companies/${p.company.id}/stock/docs/${p.doc.id}`;
  const posted = p.doc.status === 'posted';
  const readOnly = posted || p.company.archivedAt !== null || p.doc.deletedAt !== null;
  const [lines, setLines] = useState<CountLineDraft[]>(() => countDraftFromDoc(p.doc));
  const summaryRef = useRef<HTMLParagraphElement>(null);
  // свежий документ после сохранения или проведения: окно не пересоздаётся (фокус остаётся внутри и Esc работает),
  // только учёт новых строк приходит с сервера
  useEffect(() => {
    const expected = new Map(p.doc.lines.map((l) => [l.itemId, l.expected ?? null]));
    setLines((ls) => ls.map((l) => ({ ...l, expected: expected.get(l.itemId) ?? l.expected })));
  }, [p.doc]);
  // после проведения кнопки исчезают: фокус — на итог, чтобы он не ушёл из окна
  useEffect(() => {
    if (posted) summaryRef.current?.focus();
  }, [posted]);
  /** Последнее сохранение: версия документа и снимок строк. Обновляется сразу после удачного сохранения — даже если следом
   * «Провести» не прошло, следующая попытка идёт с верной версией и без лишнего «изменён другим пользователем». */
  const [saved, setSaved] = useState(() => ({ version: p.doc.version, snapshot: countSnapshot(countDraftFromDoc(p.doc)) }));
  const [confirmClose, setConfirmClose] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ask, setAsk] = useState<{ title: string; text: string; confirm: string; danger: boolean; run: () => Promise<void> } | null>(null);
  const [adding, setAdding] = useState('');
  const itemById = new Map(p.items.map((i) => [i.id, i]));
  const units = new Map<number, StockUnit>(p.items.map((i) => [i.id, i.unit]));
  const dirty = countDirty(lines, saved.snapshot);
  p.cancelRef.current = () => {
    if (pending) return;
    if (dirty && !readOnly) setConfirmClose(true);
    else p.close();
  };
  const warehouseName = p.warehouses.find((w) => w.id === p.doc.warehouseId)?.name ?? '…';
  const used = new Set(lines.map((l) => l.itemId));
  const addable = p.items.filter((i) => !i.isCombo && !i.archivedAt && !used.has(i.id));

  const failed = (e: unknown) => {
    // сервер нумерует строки так же, как окно; поле факта у сервера — countedQty
    const fields = e instanceof ApiError ? (e.fields ?? {}) : {};
    setErrors(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.replace(/\.countedQty$/, '.counted'), v])));
    setFormError(e instanceof ApiError && e.status === 409 ? 'Документ изменён другим пользователем — закройте окно и откройте снова' : errorText(e));
  };

  /** Сохранить строки черновика; возвращает новую версию или null при ошибке. */
  const saveDraft = async (forPost: boolean): Promise<number | null> => {
    const r = countBody(lines, units, forPost);
    if (!r.ok) {
      setErrors(r.errors);
      setFormError('Проверьте заполнение полей');
      return null;
    }
    if (!dirty) return saved.version;
    const { doc } = await api<{ doc: StockDoc }>(base, { method: 'PATCH', body: { version: saved.version, lines: r.lines } });
    setSaved({ version: doc.version, snapshot: countSnapshot(lines) });
    return doc.version;
  };

  const save = async () => {
    if (pending) return;
    setPending(true);
    setFormError(null);
    try {
      if ((await saveDraft(false)) !== null) {
        await invalidateStock(p.company.id);
        p.reload();
      }
    } catch (e) {
      failed(e);
    } finally {
      setPending(false);
    }
  };

  const post = async () => {
    if (pending) return;
    setFormError(null);
    const r = countBody(lines, units, true);
    if (!r.ok) {
      setErrors(r.errors);
      setFormError('Проверьте заполнение полей');
      return;
    }
    setAsk({
      title: 'Провести инвентаризацию?',
      text: 'Остатки изменятся: недостача спишется, излишек оприходуется. Изменить проведённую инвентаризацию нельзя — только удалить.',
      confirm: 'Провести',
      danger: false,
      run: async () => {
        setPending(true);
        try {
          const version = await saveDraft(true);
          if (version === null) return;
          await api(`${base}/post`, { method: 'POST', body: { version } });
          await invalidateStock(p.company.id);
          p.reload();
        } catch (e) {
          failed(e);
        } finally {
          setPending(false);
          setAsk(null);
        }
      },
    });
  };

  const askDelete = async () => {
    if (pending) return;
    setPending(true);
    setFormError(null);
    try {
      const dry = posted ? (await api<{ impact: DocImpact }>(`${base}?dryRun=1`, { method: 'DELETE' })).impact : null;
      setAsk({
        title: 'Удалить инвентаризацию?',
        text: (dry && impactText(dry, p.timeZone)) ?? (posted ? 'Остатки будут пересчитаны так, будто инвентаризации не было.' : 'Черновик будет удалён.'),
        confirm: 'Удалить',
        danger: true,
        run: async () => {
          setPending(true);
          try {
            await api(base, { method: 'DELETE' });
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

  const setCounted = (key: number, index: number, counted: string) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, counted } : l)));
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== `lines.${index}.counted` && k !== 'lines')));
  };
  // ошибки строк — по номеру: после удаления строки номера сдвигаются, прежние ошибки уже не про те строки
  const removeLine = (key: number) => {
    setLines((ls) => ls.filter((x) => x.key !== key));
    setErrors({});
  };
  const signed = (diff: number, unit: StockUnit) => (diff > 0 ? `+${qtyWithUnit(diff, unit)}` : diff < 0 ? `\u2212${qtyWithUnit(-diff, unit)}` : '0');

  // кнопки при запросе — aria-disabled, не disabled: заблокированная кнопка теряет фокус, и Esc перестаёт закрывать окно
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted">
        Склад: <strong className="text-ink">{warehouseName}</strong> · {posted ? 'Проведена' : 'Черновик'}
      </p>
      {p.doc.deletedAt && <p className={`${noticeClass} mb-0`}>Документ удалён.</p>}
      {posted && p.doc.countSummary && (
        <p ref={summaryRef} tabIndex={-1} role="status" className="rounded-xl bg-field px-4 py-3 font-medium outline-none">
          {countSummaryText(p.doc.countSummary, p.company.baseCurrency)}
        </p>
      )}
      {lines.length === 0 ? (
        <p className="text-muted">Строк нет. Добавьте товар — остаток по учёту появится после сохранения.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Строки инвентаризации" className="w-full text-sm">
            <thead>
              <tr className="border-b border-field">
                <th scope="col" className={thClass}>
                  Товар
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Учёт
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Факт
                </th>
                <th scope="col" className={`${thClass} text-right`}>
                  Разница
                </th>
                {!readOnly && <th scope="col" className={thClass} aria-label="Действия" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, index) => {
                const item = itemById.get(l.itemId);
                const unit = item?.unit ?? 'pcs';
                const diff = countDiff(l, unit);
                const error = errors[`lines.${index}.counted`];
                return (
                  <tr key={l.key} className="border-b border-field">
                    <td className={tdClass}>{item?.name ?? '…'}</td>
                    <td className={`${tdClass} text-right tabular-nums`}>{l.expected === null ? '—' : qtyWithUnit(l.expected, unit)}</td>
                    <td className={`${tdClass} text-right`}>
                      {readOnly ? (
                        <span className="tabular-nums">{l.counted === '' ? '—' : `${l.counted} ${UNIT_LABELS[unit]}`}</span>
                      ) : (
                        <>
                          <NumberInput
                            aria-label={`Факт: ${item?.name ?? ''}, ${UNIT_LABELS[unit]}`}
                            aria-invalid={error ? true : undefined}
                            value={l.counted}
                            onChange={(t) => setCounted(l.key, index, t)}
                            className={`${inputClass} w-28! text-right`}
                          />
                          {error && (
                            <p role="alert" className="mt-1 text-xs text-expense-strong">
                              {error}
                            </p>
                          )}
                        </>
                      )}
                    </td>
                    <td className={`${tdClass} text-right tabular-nums ${diff !== null && diff < 0 ? 'text-expense-strong' : ''}`}>{diff === null ? '—' : signed(diff, unit)}</td>
                    {!readOnly && (
                      <td className={tdClass}>
                        <button
                          type="button"
                          aria-label={`Убрать «${item?.name ?? ''}»`}
                          title="Убрать строку"
                          onClick={() => removeLine(l.key)}
                          className={btnIcon}
                        >
                          <span aria-hidden="true">✕</span>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {errors.lines && (
        <p role="alert" className="text-sm text-expense-strong">
          {errors.lines}
        </p>
      )}
      {!readOnly && addable.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Добавить товар">
            {(c) => (
              <select {...c} value={adding} onChange={(e) => setAdding(e.target.value)} className={`${inputClass} w-auto!`}>
                <option value="">Выберите товар</option>
                {addable.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <button
            type="button"
            aria-disabled={adding === '' || undefined}
            title={adding === '' ? 'Сначала выберите товар' : undefined}
            onClick={() => {
              if (adding === '') return;
              setLines((ls) => [...ls, newCountLine(Number(adding))]);
              setAdding('');
            }}
            className={`${btnSecondary} aria-disabled:opacity-50`}
          >
            + Добавить товар
          </button>
        </div>
      )}
      {formError && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {formError}
        </p>
      )}
      {p.company.archivedAt === null && !p.doc.deletedAt && (
        <div className="flex flex-wrap items-center gap-2">
          {!posted && (
            <>
              <button type="button" aria-disabled={pending || undefined} onClick={() => void save()} className={`${btnSecondary} aria-disabled:opacity-50`}>
                Сохранить черновик
              </button>
              <button type="button" aria-disabled={pending || undefined} onClick={() => void post()} className="h-12 rounded-xl bg-income px-6 font-semibold text-ink hover:brightness-105 aria-disabled:opacity-50">
                Провести
              </button>
            </>
          )}
          <button type="button" aria-disabled={pending || undefined} onClick={() => void askDelete()} className={`${btnDanger} ml-auto aria-disabled:opacity-50`}>
            Удалить документ
          </button>
        </div>
      )}
      <ConfirmDialog
        open={ask !== null}
        title={ask?.title ?? ''}
        text={ask?.text ?? ''}
        confirmLabel={ask?.confirm ?? 'Провести'}
        danger={ask?.danger}
        pending={pending}
        onCancel={() => setAsk(null)}
        onConfirm={() => void ask?.run()}
      />
      <ConfirmDialog
        open={confirmClose}
        title="Ваши данные не сохранятся"
        text="Закрыть окно? Внесённый факт будет потерян — сначала сохраните черновик."
        confirmLabel="Закрыть"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => p.close()}
      />
    </div>
  );
}
