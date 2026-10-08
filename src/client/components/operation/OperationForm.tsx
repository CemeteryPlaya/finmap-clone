import { useEffect, useId, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { Link } from 'react-router';
import { getCurrency } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { api, ApiError } from '../../lib/api';
import type { OperationType } from '../../lib/journal-filter';
import { invalidateOperations } from '../../lib/journal-mutations';
import {
  buildBody,
  changeType,
  emptyDraft,
  positiveAmount,
  similarDraft,
  transferRateText,
  COMMENT_MAX,
  type OperationDraft,
} from '../../lib/operation-form';
import { accountOptions, categoryOptions, counterpartyOptions, preferredCounterpartyType, projectOptions, tagOptions } from '../../lib/operation-options';
import { useMeta } from '../../lib/query';
import { startSplit } from '../../lib/split';
import {
  useAccounts,
  useCategories,
  useCounterparties,
  useProjects,
  useSplitPresets,
  useTags,
  type Account,
  type CategoryTree,
  type Company,
  type Counterparty,
  type Project,
  type SplitPreset,
  type Tag,
} from '../../lib/queries';
import { Field } from '../Field';
import { Modal } from '../Modal';
import { Pending } from '../QueryState';
import { SearchPicker } from '../SearchPicker';
import { alertClass, btnPrimary, btnSecondary, btnSmall, inputClass } from '../ui';
import { AmountField } from './AmountField';
import { ComboSelect } from './ComboSelect';
import { SplitEditor } from './SplitEditor';
import type { OperationFormRequest } from './OperationFormHost';

export interface FormData {
  accounts: Account[];
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
  tags: Tag[];
  presets: SplitPreset[];
}

const TYPES: { type: OperationType; label: string }[] = [
  { type: 'income', label: 'Доход' },
  { type: 'expense', label: 'Расход' },
  { type: 'transfer', label: 'Перевод' },
];

/** Модалка на десктопе, на телефоне (меньше 768 px) — на весь экран (§7). */
const MODAL_CLASS = 'max-w-2xl max-md:m-0 max-md:h-dvh max-md:max-h-dvh max-md:w-full max-md:max-w-none max-md:rounded-none';

/** Ошибки полей из ответа сервера: `lines.0.amount` → `lines`, `tagIds.1` → `tagIds`. */
export function serverFieldErrors(fields: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fields ?? {})) out[key.split('.')[0]!] ??= message;
  return out;
}

/**
 * Форма операции (§7): доход, расход, перевод. Окно открыто, пока форма смонтирована; закрытие — через
 * `<dialog>.close()`, чтобы фокус вернулся на кнопку, с которой форму открыли.
 */
export function OperationForm(props: { company: Company; request: OperationFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const cancel = useRef<() => void>(() => setOpen(false));
  const meta = useMeta();
  const accounts = useAccounts(props.company.id);
  const categories = useCategories(props.company.id);
  const projects = useProjects(props.company.id);
  const counterparties = useCounterparties(props.company.id);
  const tags = useTags(props.company.id);
  const presets = useSplitPresets(props.company.id);
  const queries = [meta, accounts, categories, projects, counterparties, tags];
  const data: FormData | null =
    accounts.data && categories.data && projects.data && counterparties.data && tags.data
      ? {
          accounts: accounts.data,
          categories: categories.data,
          projects: projects.data,
          counterparties: counterparties.data,
          tags: tags.data,
          // шаблоны разделения форму не блокируют: не загрузились — список пуст
          presets: presets.data ?? [],
        }
      : null;

  return (
    <Modal open={open} title="Новая операция" onClose={props.onClose} onCancel={() => cancel.current()} className={MODAL_CLASS}>
      {data && meta.data ? (
        <OperationEditor
          company={props.company}
          data={data}
          timeZone={meta.data.timezone}
          type={props.request.type}
          close={() => setOpen(false)}
          cancelRef={cancel}
        />
      ) : (
        <Pending queries={queries} />
      )}
    </Modal>
  );
}

function OperationEditor(p: {
  company: Company;
  data: FormData;
  timeZone: string;
  type: OperationType;
  close: () => void;
  /** Что делать по Esc: форма решает сама (несохранённые изменения). */
  cancelRef: MutableRefObject<() => void>;
}) {
  const today = todayInTimezone(p.timeZone);
  const typeName = useId();
  const firstAccount = p.data.accounts.find((a) => !a.archivedAt)?.id ?? null;
  const [initial, setInitial] = useState(() => emptyDraft(p.type, today, firstAccount));
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [more, setMore] = useState(false);
  const [refocusAmount, setRefocusAmount] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  /** Вопрос о несохранённом: фокус на «Продолжить», после ответа — туда, где был. */
  const continueRef = useRef<HTMLButtonElement>(null);
  const focusBefore = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (confirmClose) continueRef.current?.focus();
    else focusBefore.current?.focus();
  }, [confirmClose]);

  // Esc: открыт вопрос — продолжить ввод; есть несохранённые изменения — спросить; иначе закрыть
  p.cancelRef.current = () => {
    if (confirmClose) setConfirmClose(false);
    else if (dirty) {
      focusBefore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmClose(true);
    } else p.close();
  };

  const accounts = new Map(p.data.accounts.map((a) => [a.id, a]));
  const account = draft.accountId === null ? undefined : accounts.get(draft.accountId);
  const toAccount = draft.toAccountId === null ? undefined : accounts.get(draft.toAccountId);
  const currency = getCurrency(account?.currency ?? p.company.baseCurrency);
  const toCurrency = toAccount ? getCurrency(toAccount.currency) : null;
  const transfer = draft.type === 'transfer';
  const crossCurrency = transfer && toCurrency !== null && toCurrency.code !== currency.code;
  const kind = draft.type === 'income' ? 'income' : 'expense';
  const activeAccounts = p.data.accounts.filter((a) => !a.archivedAt);
  const amountParsed = positiveAmount(draft.amount, currency.minorUnits);
  const amountMinor = amountParsed.ok ? amountParsed.minor : null;
  // подходящий тип контрагента — по статье операции или первой строки разбиения
  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;

  /** Изменение полей: сбрасывает их ошибки и сообщение «сохранено». */
  const set = (patch: Partial<OperationDraft>, ...errorKeys: string[]) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
    if (errorKeys.length) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !errorKeys.includes(k))));
  };

  const submit = async (then: 'close' | 'similar') => {
    if (pending) return;
    const now = new Date();
    // buildBody вычисляет выражение в сумме само: Enter или «Сохранить» без ухода из поля сохраняют результат
    const r = buildBody(draft, { accounts, today: todayInTimezone(p.timeZone, now), timeZone: p.timeZone, now, timeOfDayFrom: now });
    if (!r.ok) {
      setErrors(r.errors);
      setFormError('Проверьте заполнение полей');
      return;
    }
    setPending(true);
    setErrors({});
    setFormError(null);
    setStatus(null);
    try {
      await api(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body });
      void invalidateOperations(p.company.id);
      if (then === 'close') {
        p.close();
        return;
      }
      const next = similarDraft(draft);
      setDraft(next);
      setInitial(next);
      setStatus('Операция сохранена — можно ввести похожую');
      setRefocusAmount((n) => n + 1);
    } catch (e) {
      setErrors(serverFieldErrors(e instanceof ApiError ? e.fields : undefined));
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit('close');
  };

  if (activeAccounts.length === 0) {
    return (
      <div>
        <p className="mb-4 text-muted">В компании нет счетов — операцию не к чему привязать.</p>
        <div className="flex gap-2">
          <Link to={`/c/${p.company.id}/settings/accounts`} onClick={p.close} className={btnPrimary}>
            Добавить счёт
          </Link>
          <button type="button" onClick={p.close} className={btnSecondary}>
            Закрыть
          </button>
        </div>
      </div>
    );
  }

  const accountField = (label: string, key: 'accountId' | 'toAccountId') => (
    <ComboSelect
      label={label}
      listLabel="Счета"
      value={draft[key]}
      options={accountOptions(p.data.accounts, draft[key])}
      emptyLabel={null}
      placeholder="Выберите счёт"
      onChange={(id) => set({ [key]: id }, key)}
      error={errors[key]}
    />
  );

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Операция" className="grid gap-4">
      <fieldset disabled={pending}>
        <legend className="sr-only">Тип операции</legend>
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-field p-1">
          {TYPES.map((t) => (
            <label
              key={t.type}
              className="relative cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold text-muted has-[:checked]:bg-card has-[:checked]:text-ink has-[:checked]:shadow has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus"
            >
              <input
                type="radio"
                name={typeName}
                value={t.type}
                checked={draft.type === t.type}
                onChange={() => {
                  setDraft((d) => changeType(d, t.type));
                  setErrors({});
                }}
                // поверх подписи и прозрачная: нажатие попадает в саму радиокнопку
                className="absolute inset-0 cursor-pointer appearance-none rounded-lg opacity-0"
              />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>

      {/* пока запрос идёт, поля недоступны: «похожий» копирует ровно то, что ушло на сервер */}
      <fieldset disabled={pending} className="contents">
      <div className="grid gap-4 md:grid-cols-2">
        {accountField(transfer ? 'Со счёта' : 'Счёт', 'accountId')}
        {transfer && accountField('На счёт', 'toAccountId')}
        <AmountField
          label={`Сумма, ${currency.symbol}`}
          value={draft.amount}
          onChange={(amount) => set({ amount }, 'amount')}
          minorUnits={currency.minorUnits}
          error={errors.amount}
          autoFocus
          refocusSignal={refocusAmount}
        />
        {crossCurrency && toCurrency && (
          <AmountField
            label={`Сумма зачисления, ${toCurrency.symbol}`}
            value={draft.toAmount}
            onChange={(toAmount) => set({ toAmount }, 'toAmount')}
            minorUnits={toCurrency.minorUnits}
            error={errors.toAmount}
            hint={rateHint(draft, currency.code, currency.minorUnits, toCurrency.code, toCurrency.minorUnits)}
          />
        )}
      </div>

      {!transfer && (
        <div className="grid gap-4 md:grid-cols-2">
          {draft.split ? (
            <SplitEditor
              companyId={p.company.id}
              kind={kind}
              value={draft.split}
              onChange={(split) => set({ split }, 'lines')}
              onCancel={() => set({ split: null, categoryId: draft.split!.lines[0]?.categoryId ?? null, projectId: draft.split!.lines[0]?.projectId ?? null }, 'lines')}
              total={amountMinor}
              currency={currency.code}
              minorUnits={currency.minorUnits}
              categories={p.data.categories}
              projects={p.data.projects}
              presets={p.data.presets}
              error={errors.lines}
            />
          ) : (
            <div>
              <ComboSelect
                label="Статья"
                listLabel="Статьи"
                value={draft.categoryId}
                options={categoryOptions(p.data.categories, kind, [draft.categoryId])}
                emptyLabel="Без статьи"
                onChange={(categoryId) => set({ categoryId }, 'lines')}
                error={errors.lines}
              />
              <button
                type="button"
                onClick={() => set({ split: startSplit(draft.categoryId, draft.projectId, draft.amount) }, 'lines')}
                className="mt-1 text-sm font-semibold text-income hover:underline"
              >
                Разделить
              </button>
            </div>
          )}
          <ComboSelect
            label="Контрагент"
            listLabel="Контрагенты"
            value={draft.counterpartyId}
            options={counterpartyOptions(p.data.counterparties, draft.counterpartyId, preferredCounterpartyType(p.data.categories, mainCategory))}
            emptyLabel="Без контрагента"
            onChange={(counterpartyId) => set({ counterpartyId }, 'counterpartyId')}
            error={errors.counterpartyId}
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label={transfer ? 'Дата' : 'Дата оплаты'} error={errors.paidAt}>
          {(c) => (
            <input {...c} type="date" max={today} value={draft.paidDate} onChange={(e) => set({ paidDate: e.target.value }, 'paidAt')} className={inputClass} />
          )}
        </Field>
        {!transfer && (
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm md:pt-7">
              <input type="checkbox" checked={draft.accrualOn} onChange={(e) => set({ accrualOn: e.target.checked }, 'accrualDate')} />
              Дата сделки отличается
            </label>
            {draft.accrualOn && (
              <Field label="Дата сделки" error={errors.accrualDate}>
                {(c) => (
                  <input {...c} type="date" value={draft.accrualDate} onChange={(e) => set({ accrualDate: e.target.value }, 'accrualDate')} className={inputClass} />
                )}
              </Field>
            )}
          </div>
        )}
      </div>

      <div>
        <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} className="text-sm font-semibold text-muted hover:text-ink">
          <span aria-hidden="true">{more ? '▾' : '▸'}</span> Проект, теги, комментарий
        </button>
        {more && (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {!draft.split && (
              <ComboSelect
                label="Проект"
                listLabel="Проекты"
                value={draft.projectId}
                options={projectOptions(p.data.projects, [draft.projectId])}
                emptyLabel="Без проекта"
                onChange={(projectId) => set({ projectId }, 'lines')}
                error={transfer ? errors.lines : undefined}
              />
            )}
            <TagsField tags={p.data.tags} value={draft.tagIds} onChange={(tagIds) => set({ tagIds }, 'tagIds')} error={errors.tagIds} />
            <Field label="Комментарий" error={errors.comment} className="md:col-span-2">
              {(c) => (
                <textarea {...c} rows={2} maxLength={COMMENT_MAX} value={draft.comment} onChange={(e) => set({ comment: e.target.value }, 'comment')} className={inputClass} />
              )}
            </Field>
          </div>
        )}
      </div>
      </fieldset>

      {formError && (
        <p role="alert" className={`${alertClass} mb-0`}>
          {formError}
        </p>
      )}
      {/* область role="status" есть всегда — меняется только текст, так его объявляют программы чтения с экрана */}
      <p role="status" className={status ? 'rounded-xl bg-income-soft px-4 py-3 text-sm text-income' : 'sr-only'}>
        {status}
      </p>

      {confirmClose ? (
        <div role="group" aria-label="Несохранённые изменения" className="flex flex-wrap items-center gap-2 text-sm">
          <span>Есть несохранённые изменения. Закрыть без сохранения?</span>
          <button type="button" onClick={p.close} className={btnSecondary}>
            Закрыть без сохранения
          </button>
          <button type="button" ref={continueRef} onClick={() => setConfirmClose(false)} className={btnPrimary}>
            Продолжить
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={pending} className={btnPrimary}>
            Сохранить
          </button>
          <button type="button" disabled={pending} onClick={() => void submit('similar')} className={btnSecondary}>
            Сохранить и создать похожий
          </button>
          <button type="button" onClick={() => p.cancelRef.current()} className={btnSecondary}>
            Отмена
          </button>
        </div>
      )}
    </form>
  );
}

/** Подсказка у «Суммы зачисления»: курс из двух сумм, когда обе введены. */
function rateHint(draft: OperationDraft, from: string, fromMinor: number, to: string, toMinor: number): string | undefined {
  const a = positiveAmount(draft.amount, fromMinor);
  const b = positiveAmount(draft.toAmount, toMinor);
  const text = a.ok && b.ok ? transferRateText(a.minor, from, b.minor, to) : null;
  return text ? `Курс: ${text}` : undefined;
}

/** Теги операции: выбранные — с кнопкой «убрать», добавление — список с поиском. */
function TagsField(props: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void; error?: string }) {
  const names = new Map(props.tags.map((t) => [t.id, t.name]));
  const options = tagOptions(props.tags, props.value).filter((o) => !props.value.includes(o.id));
  return (
    <div role="group" aria-label="Теги">
      <span className="mb-1 block text-sm text-muted">Теги</span>
      <div className="flex flex-wrap items-center gap-2">
        {props.value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-field px-3 py-1 text-sm">
            {names.get(id) ?? '…'}
            <button type="button" aria-label={`Убрать тег «${names.get(id) ?? ''}»`} onClick={() => props.onChange(props.value.filter((x) => x !== id))} className="text-muted hover:text-ink">
              ×
            </button>
          </span>
        ))}
        <SearchPicker label="+ Тег" ariaLabel="Добавить тег" listLabel="Теги" options={options} onPick={(id) => props.onChange([...props.value, id])} buttonClassName={btnSmall} />
      </div>
      {props.error && <span className="mt-1 block text-sm text-expense">{props.error}</span>}
    </div>
  );
}
