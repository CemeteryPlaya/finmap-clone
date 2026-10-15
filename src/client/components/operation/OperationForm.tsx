import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type MutableRefObject } from 'react';
import { Link } from 'react-router';
import { getCurrency } from '../../../shared/currencies';
import { todayInTimezone } from '../../../shared/dates';
import { api, ApiError } from '../../lib/api';
import { isFileDrag, uploadAttachment, uploadErrorText, useAttachments } from '../../lib/attachments';
import type { OperationType } from '../../lib/journal-filter';
import { dayOf } from '../../lib/journal-format';
import { invalidateOperations } from '../../lib/journal-mutations';
import { defaultAccounts, readLastAccounts, saveLastAccounts, withSaved } from '../../lib/last-account';
import { useNow } from '../../lib/use-now';
import { createFromForm, type CreatableKind } from '../../lib/operation-create';
import { invalidateStock } from '../../lib/stock';
import {
  archivedAccountOf,
  convertBlockedHint,
  convertQuestion,
  convertToTransferDraft,
  draftFromOperation,
  duplicateDraft,
  patchBody,
  pickConvertedFrom,
  type Available,
  type ConvertNames,
  type OperationRecord,
} from '../../lib/operation-edit';
import {
  buildBody,
  COMMENT_MAX,
  emptyDraft,
  initialFocusField,
  FIELD_LABELS,
  operationTitle,
  paidDateOf,
  payAccountId,
  positiveAmount,
  salaryRowText,
  shownPaidTime,
  similarDraft,
  stockPaymentsLost,
  submitLabel,
  transferRateText,
  type OperationDraft,
  type OperationPrefill,
} from '../../lib/operation-form';
import {
  accountOptions,
  categoryOptions,
  counterpartyLabel,
  counterpartyOptions,
  findCategory,
  preferredCounterpartyType,
  projectOptions,
  salaryCategory,
  tagOptions,
} from '../../lib/operation-options';
import { SKIP_CLOSE_CONFIRM_PREF, skipCloseConfirm } from '../../lib/preferences';
import {
  savePreference,
  useAccounts,
  useCategories,
  useCounterparties,
  usePreferences,
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
import { useMe, useMeta } from '../../lib/query';
import { startSplit } from '../../lib/split';
import { ConfirmDialog } from '../ConfirmDialog';
import { useComboList } from '../ComboList';
import { DateField } from '../DateField';
import { Field } from '../Field';
import { isCoarsePointer, refocusTarget } from '../focus-trap';
import { CalendarIcon, ChevronIcon, CopyIcon, SplitIcon, TransferIcon, TrashIcon } from '../icons';
import { Modal } from '../Modal';
import { Pending } from '../QueryState';
import {
  alertClass,
  btnExpense,
  btnIcon,
  btnIncome,
  btnPrimary,
  btnSecondary,
  btnTransfer,
  floatingTextareaClass,
  noticeClass,
  phoneFullScreenModal,
} from '../ui';
import { ActionRow } from './ActionRow';
import { AmountField } from './AmountField';
import { AttachmentsField } from './AttachmentsField';
import { ComboSelect } from './ComboSelect';
import { DateTimeField } from './DateTimeField';
import type { OperationFormRequest } from './OperationFormHost';
import { StockPaymentsField } from '../stock/StockPaymentsField';
import { RateFix, type MissingRate } from './RateFix';
import { SalaryRow } from './SalaryRow';
import { SplitEditor } from './SplitEditor';

export interface FormData {
  accounts: Account[];
  categories: CategoryTree;
  projects: Project[];
  counterparties: Counterparty[];
  tags: Tag[];
  presets: SplitPreset[];
}

/** Подсказка у полей, которые нельзя менять: операция затрагивает архивный счёт (инвариант 7, §7). */
const LOCKED_HINT = 'счёт в архиве';

/**
 * Окно 480 px в одну колонку (§6.1 этапа 1.5); на телефоне (меньше 768 px) — на весь экран (§7); в PWA на iPhone поля
 * не уходят под вырез экрана и «домашнюю» полосу (safe-area).
 */
const MODAL_CLASS = `max-w-[480px] ${phoneFullScreenModal}`;

/** Главная кнопка — цвета типа (§6.9 этапа 1.5). */
const SUBMIT_CLASS: Record<OperationType, string> = { income: btnIncome, expense: btnExpense, transfer: btnTransfer };

/** Ошибки полей из ответа сервера: `lines.0.amount` → `lines`, `tagIds.1` → `tagIds`. */
export function serverFieldErrors(fields: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fields ?? {})) out[key.split('.')[0]!] ??= message;
  return out;
}

/**
 * Форма операции (§7, §6 этапа 1.5): отдельное окно на тип — доход, расход, перевод. Окно открыто, пока форма
 * смонтирована; закрытие — через `<dialog>.close()`, чтобы фокус вернулся на кнопку, с которой форму открыли.
 */
export function OperationForm(props: { company: Company; request: OperationFormRequest; onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(props.request.kind === 'edit');
  /** Тип черновика формы: «Изменить в перевод» делает его переводом до сохранения (§6.8 этапа 1.5); null — форма ещё не открыта. */
  const [draftType, setDraftType] = useState<OperationType | null>(null);
  const deleted = useRef(false);
  const editId = props.request.kind === 'edit' ? props.request.id : null;
  // операция для правки — всегда свежая с сервера: версия нужна для PATCH
  const operation = useQuery<OperationRecord, ApiError>({
    queryKey: ['operation', props.company.id, editId],
    queryFn: async () => (await api<{ operation: OperationRecord }>(`/companies/${props.company.id}/operations/${editId}`)).operation,
    enabled: editId !== null,
    gcTime: 0,
  });
  const cancel = useRef<() => void>(() => setOpen(false));
  const meta = useMeta();
  const accounts = useAccounts(props.company.id);
  const categories = useCategories(props.company.id);
  const projects = useProjects(props.company.id);
  const counterparties = useCounterparties(props.company.id);
  const tags = useTags(props.company.id);
  const presets = useSplitPresets(props.company.id);
  const queries = [meta, accounts, categories, projects, counterparties, tags, ...(editId !== null ? [operation] : [])];
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
  // тип новой операции задаёт кнопка шапки, существующей — она сама (§6.1 этапа 1.5); пока операция грузится — «Операция»
  const type = props.request.kind === 'create' ? props.request.type : operation.data?.type;
  // заголовок — по типу черновика: после «Изменить в перевод» — «Перевод» (§6.8 этапа 1.5)
  const shownType = draftType ?? type;

  return (
    <Modal
      open={open}
      title={shownType ? operationTitle(shownType, editing) : 'Операция'}
      onClose={() => {
        props.onClose();
        // после удаления строки, с которой открыли форму, больше нет — фокус туда, куда просил открывший
        const target = deleted.current && props.request.kind === 'edit' ? props.request.focusAfterDelete?.() : null;
        if (target) requestAnimationFrame(() => target.focus());
      }}
      onCancel={() => cancel.current()}
      className={MODAL_CLASS}
      phoneFullScreen
    >
      {data && meta.data && (editId === null || operation.data) ? (
        <OperationEditor
          company={props.company}
          data={data}
          timeZone={meta.data.timezone}
          type={props.request.kind === 'create' ? props.request.type : operation.data!.type}
          prefill={props.request.kind === 'create' ? props.request.prefill : undefined}
          operation={operation.data ?? null}
          onEditingChange={setEditing}
          onTypeChange={setDraftType}
          onDeleted={() => (deleted.current = true)}
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
  /** Новая операция из «Оплатить» у поступления склада: что подставить в пустую форму. */
  prefill?: OperationPrefill;
  /** Правка существующей операции; null — новая. */
  operation: OperationRecord | null;
  /** Форма перешла от правки к новой операции («Дублировать платёж»). */
  onEditingChange: (editing: boolean) => void;
  /** Тип черновика сменился («Изменить в перевод», «Загрузить актуальную»): заголовок окна следует за ним. */
  onTypeChange: (type: OperationType) => void;
  /** Операция удалена: окно закроется, фокус — не на исчезнувшую строку. */
  onDeleted: () => void;
  close: () => void;
  /** Что делать по Esc: форма решает сама (несохранённые изменения). */
  cancelRef: MutableRefObject<() => void>;
}) {
  const today = todayInTimezone(p.timeZone);
  // «живое» время новой операции: «сегодня» и «сейчас» из одного момента, обновляются раз в минуту (§2.3 этапа 1.5)
  const clock = useNow(p.timeZone);
  // архивная компания — только просмотр: поля недоступны, строк-действий, кнопок сохранения и файлов нет
  const readOnly = p.company.archivedAt !== null;
  const accounts = new Map(p.data.accounts.map((a) => [a.id, a]));
  // последний счёт этого пользователя в этой компании для этого типа (§6.2 этапа 1.5); не выбирался или в архиве — пусто
  const userId = useMe().data?.user.id ?? null;
  const [remembered] = useState(() => defaultAccounts(p.type, userId === null ? {} : readLastAccounts(userId, p.company.id), p.data.accounts));
  const [op, setOp] = useState(p.operation);
  const [initial, setInitial] = useState(() =>
    op
      ? draftFromOperation(op, accounts, p.timeZone)
      : {
          // «Оплатить» с запомненным счётом в чужой валюте: оплата закупки возможна только с базовой — берём счёт в ней (R12)
          ...emptyDraft(
            p.type,
            today,
            p.prefill?.stockPayments?.length ? payAccountId(remembered.accountId, p.data.accounts, p.company.baseCurrency) : remembered.accountId,
            remembered.toAccountId,
          ),
          ...p.prefill,
        },
  );
  const [draft, setDraft] = useState(initial);
  /** Фокус при открытии — первое пустое обязательное поле (§6.2): счёт, иначе сумма; при правке — сумма. */
  const [focusField] = useState(() => initialFocusField(initial, p.operation !== null));
  /** «Удалить платёж» (§6.7 этапа 1.5): подтверждение — вложенное окно. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** «Изменить в перевод» (§6.8 этапа 1.5): подтверждение со списком того, что будет убрано; null — закрыто. */
  const [convertLosses, setConvertLosses] = useState<string[] | null>(null);
  /** Сигнал: форма стала переводом — фокус на пустой счёт перевода. */
  const [convertFocus, setConvertFocus] = useState(0);
  /**
   * Доход, изменённый в перевод (§6.8): прежняя сумма — «Сумма зачисления»; выбор «Со счёта» в другой валюте очищает
   * сумму списания (pickConvertedFrom). null — правило не действует (расход, «Загрузить актуальную», «Дублировать»).
   */
  const [carried, setCarried] = useState<string | null>(null);
  /** 409 при сохранении правки: операцию изменили или удалили после того, как форму открыли. */
  const [conflict, setConflict] = useState<'changed' | 'deleted' | null>(null);
  /** RATE_UNAVAILABLE: какого курса нет; «Повторить» сохраняет тем же способом (lastThen). */
  const [missingRate, setMissingRate] = useState<MissingRate | null>(null);
  const lastThen = useRef<'close' | 'similar'>('close');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  /** «Больше не спрашивать» (§2.4 этапа 1.5): настройка пользователя; флажок в вопросе — до нажатия «Закрыть». */
  const prefs = usePreferences();
  const skipAsk = skipCloseConfirm(prefs.data);
  const [dontAsk, setDontAsk] = useState(false);
  // блок строки «Добавить проект, тег, комментарий, файл» раскрыт, если в нём уже что-то есть (§6.7 этапа 1.5)
  const [more, setMore] = useState(() => readOnly || initial.projectId !== null || initial.tagIds.length > 0 || initial.comment !== '');
  const [refocusAmount, setRefocusAmount] = useState(0);
  /** Строка «Дата сделки отличается» и поле «Дата сделки» сменяют друг друга: куда перевести фокус после смены. */
  const [accrualFocus, setAccrualFocus] = useState<'field' | 'row' | null>(null);
  const accrualRowRef = useRef<HTMLButtonElement>(null);
  /** Дата сделки до включения строки «Дата сделки отличается»: «✕» возвращает её. */
  const accrualBefore = useRef<string | null>(null);
  // файлы операции раскрывают тот же блок; их список приходит отдельным запросом (его же использует AttachmentsField)
  const hasFiles = (useAttachments(p.company.id, op?.id ?? null).data?.length ?? 0) > 0;
  useEffect(() => {
    if (hasFiles) setMore(true);
  }, [hasFiles]);
  /** Файлы, брошенные на форму мимо зоны файлов: блок раскрывается, `AttachmentsField` их принимает. */
  const [incoming, setIncoming] = useState<File[] | null>(null);
  // пока форма открыта, файл, брошенный мимо неё, не должен открыться в браузере (страница с формой была бы потеряна)
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (!e.dataTransfer || !isFileDrag([...e.dataTransfer.types])) return;
      e.preventDefault();
      // вне формы (фон, вложенные окна) бросить файл нельзя — курсор «копировать» не показываем
      if (!(e.target instanceof Node && formRef.current?.contains(e.target))) e.dataTransfer.dropEffect = 'none';
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);
  /** Файлы, выбранные до создания операции: загружаются сразу после него (§7). */
  const [files, setFiles] = useState<File[]>([]);
  /** Ошибка сохранения: фокус — на первое поле с ошибкой или действие в сообщении (поля были недоступны, фокус потерян). */
  const formRef = useRef<HTMLFormElement>(null);
  const [errorFocus, setErrorFocus] = useState(0);
  const dirty = files.length > 0 || JSON.stringify(draft) !== JSON.stringify(initial);
  /** Только просмотр: поле суммы недоступно, начальный фокус — на «×» окна. */
  const closeButton = () => formRef.current?.closest('dialog')?.querySelector<HTMLButtonElement>('[data-modal-close]') ?? null;

  useEffect(() => {
    if (!readOnly) return;
    closeButton()?.focus({ preventScroll: true });
    // окно ещё может открываться (данные были в кэше): showModal() переставил бы фокус на первый элемент
    const frame = requestAnimationFrame(() => {
      const close = closeButton();
      if (close?.isConnected && document.activeElement !== close) close.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [readOnly]);

  // заголовок окна — по типу черновика (§6.8 этапа 1.5): перевод после «Изменить в перевод», прежний тип после «Загрузить актуальную»
  useEffect(() => {
    p.onTypeChange(draft.type);
  }, [draft.type]);

  // после «Изменить в перевод» строки больше нет: фокус — на пустой счёт перевода («На счёт» у расхода, «Со счёта» у
  // дохода); на устройстве с пальцем — на «×», чтобы не поднимать клавиатуру (refocusTarget, план 1.5-5b).
  // Сигнал приходит дважды при подтверждении (после перестройки и при закрытии ConfirmDialog) — повтор безвреден
  useEffect(() => {
    if (!convertFocus) return;
    if (refocusTarget(isCoarsePointer()) === 'close') {
      closeButton()?.focus({ preventScroll: true });
      return;
    }
    const key = draft.accountId === null ? 'accountId' : 'toAccountId';
    formRef.current?.querySelector<HTMLInputElement>(`[data-field="${key}"] input`)?.focus();
  }, [convertFocus]);

  useEffect(() => {
    if (!accrualFocus) return;
    const target = accrualFocus === 'row' ? accrualRowRef.current : formRef.current?.querySelector<HTMLElement>('[data-accrual-field] button');
    target?.focus();
    setAccrualFocus(null);
  }, [accrualFocus]);

  useEffect(() => {
    if (!errorFocus) return;
    const form = formRef.current;
    const target = form?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? form?.querySelector<HTMLElement>('[role="alert"] button');
    if (target) target.focus();
    else setRefocusAmount((n) => n + 1);
  }, [errorFocus]);

  // Esc и «×»: пока идёт запрос — ничего (окно закрылось бы, а операция всё равно сохранится); есть несохранённые
  // изменения и вопрос не выключен — спросить (вложенное окно, его Esc сюда не доходит); иначе закрыть.
  // Вложенные подтверждения («Удалить платёж?», разбиение) свои Esc обрабатывают сами
  p.cancelRef.current = () => {
    if (pending) return;
    if (dirty && !skipAsk) {
      setDontAsk(false);
      setConfirmClose(true);
    } else p.close();
  };

  const account = draft.accountId === null ? undefined : accounts.get(draft.accountId);
  // дата оплаты: не тронутая руками у новой операции следует за «сегодня» (R5: форма, открытая до полуночи)
  const paidDate = paidDateOf(draft, clock.today);
  const toAccount = draft.toAccountId === null ? undefined : accounts.get(draft.toAccountId);
  const currency = getCurrency(account?.currency ?? p.company.baseCurrency);
  const toCurrency = toAccount ? getCurrency(toAccount.currency) : null;
  const transfer = draft.type === 'transfer';
  // поле «Оплата закупки» видно у расхода с поставщиком со счёта в валюте компании; если у правимой операции были оплаты, а поля больше нет — они снимутся
  const stockPaymentsField = draft.type === 'expense' && draft.counterpartyId !== null && account?.currency === p.company.baseCurrency;
  const stockPaymentsDropped = stockPaymentsLost(op, draft, stockPaymentsField);
  const labels = FIELD_LABELS[draft.type];
  const crossCurrency = transfer && toCurrency !== null && toCurrency.code !== currency.code;
  const kind = draft.type === 'income' ? 'income' : 'expense';
  const activeAccounts = p.data.accounts.filter((a) => !a.archivedAt);
  const amountParsed = positiveAmount(draft.amount, currency.minorUnits);
  const amountMinor = amountParsed.ok ? amountParsed.minor : null;
  // подходящий тип контрагента — по категории операции или первой строки разбиения
  const mainCategory = draft.split ? (draft.split.lines[0]?.categoryId ?? null) : draft.categoryId;
  // зарплата (эффективный systemKey = salary): вместо «Дата сделки отличается» — «{Категория} за {месяц}» (§6.7, строка 1а)
  const salary = salaryCategory(p.data.categories, mainCategory);
  // операция на архивном счёте: сумма, дата оплаты и счета заблокированы, удалить нельзя (инвариант 7)
  const locked = op ? archivedAccountOf(op, accounts) : null;
  const lockHint = locked ? LOCKED_HINT : undefined;

  /**
   * «+ Создать „…“» (§7): создать элемент справочника и выбрать его. Контрагент получает тип, подходящий категории,
   * иначе «Клиент» у дохода и «Поставщик» у расхода. apply — функцией от свежего черновика: создание идёт асинхронно.
   * Результат: false — создать не удалось (поле списка оставляет набранное название).
   */
  const createItem = async (what: CreatableKind, name: string, apply: (d: OperationDraft, id: number) => OperationDraft): Promise<boolean> => {
    setFormError(null);
    try {
      const counterpartyType = preferredCounterpartyType(p.data.categories, mainCategory) ?? (kind === 'income' ? 'client' : 'supplier');
      const id = await createFromForm(p.company.id, what, name, { kind, counterpartyType });
      setDraft((d) => apply(d, id));
      return true;
    } catch (e) {
      const message = e instanceof ApiError ? (e.fields?.name ?? e.message) : 'Ошибка сервера';
      setFormError(`Не удалось создать «${name}»: ${message}`);
      return false;
    }
  };
  const createLine = (field: 'categoryId' | 'projectId') => (name: string, key: number) =>
    createItem(field === 'categoryId' ? 'category' : 'project', name, (d, id) =>
      d.split ? { ...d, split: { ...d.split, lines: d.split.lines.map((l) => (l.key === key ? { ...l, [field]: id } : l)) } } : d,
    );

  /** Изменение полей: сбрасывает их ошибки и сообщение «сохранено». */
  const set = (patch: Partial<OperationDraft>, ...errorKeys: string[]) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
    // курс, которого не хватало, относился к прежней дате/счёту
    if ('paidDate' in patch || 'accountId' in patch || 'toAccountId' in patch) setMissingRate(null);
    if (errorKeys.length) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !errorKeys.includes(k))));
  };

  /** «Со счёта» у бывшего дохода (R4): функциональное обновление не затирает параллельные правки черновика; ошибки и статус — как в `set`. */
  const pickFromAccount = (id: number | null, from: string) => {
    setDraft((d) => pickConvertedFrom(d, id, accounts, from));
    setStatus(null);
    setMissingRate(null);
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !['accountId', 'amount', 'toAmount'].includes(k))));
  };

  const submit = async (then: 'close' | 'similar') => {
    if (pending) return;
    lastThen.current = then;
    setMissingRate(null);
    const now = new Date();
    // у существующей операции при смене дня сохраняется прежнее время суток
    const timeOfDayFrom = op ? new Date(op.paidAt) : now;
    // buildBody разбирает сумму сам: Enter или главная кнопка без ухода из поля сохраняют текущий текст
    const r = buildBody(draft, {
      accounts,
      today: todayInTimezone(p.timeZone, now),
      timeZone: p.timeZone,
      now,
      timeOfDayFrom,
      originalPaidAt: op?.paidAt,
      baseCurrency: p.company.baseCurrency,
    });
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
      if (op) {
        // в PATCH — только изменённые поля (итоги плана 4a, п. 1); без изменений запроса нет
        const patch = patchBody(op, r.body, p.timeZone);
        if (patch) await api(`/companies/${p.company.id}/operations/${op.id}`, { method: 'PATCH', body: patch });
      } else {
        const created = (await api<{ operation: OperationRecord }>(`/companies/${p.company.id}/operations`, { method: 'POST', body: r.body })).operation;
        // запомнить счета новой операции (решение 6 плана 1.5-3b): в следующий раз они подставятся сами
        if (userId !== null) saveLastAccounts(userId, p.company.id, withSaved(readLastAccounts(userId, p.company.id), r.body.type, r.body.accountId, r.body.toAccountId));
        const failed: string[] = [];
        for (const f of files) {
          try {
            await uploadAttachment(p.company.id, created.id, f);
          } catch (e) {
            failed.push(`«${f.name}»: ${uploadErrorText(e)}`);
          }
        }
        setFiles([]);
        if (failed.length > 0) {
          // операция уже есть: форма переходит к её правке, чтобы файл можно было выбрать заново
          void invalidateOperations(p.company.id);
          void invalidateStock(p.company.id);
          const saved = draftFromOperation(created, accounts, p.timeZone);
          setOp(created);
          p.onEditingChange(true);
          setDraft(saved);
          setInitial(saved);
          setMore(true);
          setFormError(`Операция сохранена, но не загружено: ${failed.join('; ')}`);
          setErrorFocus((n) => n + 1);
          return;
        }
      }
      void invalidateOperations(p.company.id);
      // оплаты закупок меняют «оплачено» у поступлений склада
      void invalidateStock(p.company.id);
      if (then === 'close') {
        p.close();
        return;
      }
      // «создать похожий» есть только у новой операции (при правке — «Дублировать платёж»)
      const next = similarDraft(draft, todayInTimezone(p.timeZone, now));
      setOp(null);
      p.onEditingChange(false);
      setDraft(next);
      setInitial(next);
      setStatus('Операция сохранена — можно ввести похожую');
      setRefocusAmount((n) => n + 1);
    } catch (e) {
      const currency = e instanceof ApiError ? e.details?.currency : undefined;
      const date = e instanceof ApiError ? e.details?.date : undefined;
      if (e instanceof ApiError && e.code === 'RATE_UNAVAILABLE' && typeof currency === 'string' && typeof date === 'string') {
        setMissingRate({ message: e.message, currency, date });
        setErrorFocus((x) => x + 1);
        return;
      }
      if (op && e instanceof ApiError && e.status === 409) {
        if (e.message.startsWith('Операция удалена')) {
          setConflict('deleted');
          // строки больше нет: «Закрыть» вернёт фокус на заголовок журнала
          p.onDeleted();
        } else setConflict('changed');
        void invalidateOperations(p.company.id);
        setErrorFocus((n) => n + 1);
        return;
      }
      const fieldErrors = serverFieldErrors(e instanceof ApiError ? e.fields : undefined);
      setErrors(fieldErrors);
      // у типа операции поля в форме нет: отказ в смене типа («Изменить в перевод») показывает сообщение формы
      setFormError(fieldErrors.type ?? (e instanceof ApiError ? e.message : 'Ошибка сервера'));
      setErrorFocus((n) => n + 1);
    } finally {
      setPending(false);
    }
  };

  /** «Загрузить актуальную» (§7): форма показывает свежую версию, свои изменения пользователь вносит заново. */
  const reload = async () => {
    if (!op) return;
    setPending(true);
    try {
      const fresh = (await api<{ operation: OperationRecord }>(`/companies/${p.company.id}/operations/${op.id}`)).operation;
      if (fresh.deletedAt) {
        setConflict('deleted');
        p.onDeleted();
        return;
      }
      const next = draftFromOperation(fresh, accounts, p.timeZone);
      setOp(fresh);
      setDraft(next);
      setInitial(next);
      setCarried(null);
      setConflict(null);
      setErrors({});
      setFormError(null);
      setStatus('Загружена актуальная версия — внесите изменения заново');
      setRefocusAmount((n) => n + 1);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  /** Неархивные элементы справочников: только их может выбрать новая операция (инвариант 7). */
  const available = (): Available => {
    const ids = <T extends { id: number; archivedAt: string | null }>(xs: readonly T[]) => new Set(xs.filter((x) => !x.archivedAt).map((x) => x.id));
    const categories = new Set(
      [...p.data.categories.income, ...p.data.categories.expense].flatMap((n) =>
        n.archivedAt ? [] : [n.id, ...n.children.filter((c) => !c.archivedAt).map((c) => c.id)],
      ),
    );
    return { accounts: ids(p.data.accounts), categories, projects: ids(p.data.projects), counterparties: ids(p.data.counterparties), tags: ids(p.data.tags) };
  };

  /** «Удалить платёж» после подтверждения: успех — окно закрывается; ошибка — сообщение, фокус возвращается на строку. */
  const remove = async () => {
    if (!op) return;
    setPending(true);
    setFormError(null);
    try {
      await api(`/companies/${p.company.id}/operations/${op.id}`, { method: 'DELETE' });
      void invalidateOperations(p.company.id);
      void invalidateStock(p.company.id);
      setConfirmDelete(false);
      p.onDeleted();
      p.close();
    } catch (e) {
      setConfirmDelete(false);
      setFormError(e instanceof ApiError ? e.message : 'Ошибка сервера');
    } finally {
      setPending(false);
    }
  };

  /** «Дублировать платёж» (§6.7): новая операция с теми же значениями на сегодня; закрыть её без сохранения — с вопросом. */
  const duplicate = () => {
    const copy = duplicateDraft(draft, available(), today);
    setOp(null);
    setCarried(null);
    p.onEditingChange(false);
    setFiles([]);
    setDraft(copy);
    // счета, выбранные с тех пор, как форму открыли, тоже считаются «прежними»
    const last = defaultAccounts(copy.type, userId === null ? {} : readLastAccounts(userId, p.company.id), p.data.accounts);
    setInitial(emptyDraft(copy.type, today, last.accountId, last.toAccountId));
    setErrors({});
    setFormError(null);
    setConflict(null);
    setMissingRate(null);
    setStatus('Это копия — проверьте и сохраните');
    setRefocusAmount((n) => n + 1);
  };

  /** Названия для списка потерь «Изменить в перевод»: категория (в том числе дочерняя) и контрагент. */
  const convertNames: ConvertNames = {
    category: (id) => findCategory(p.data.categories, id)?.name,
    counterparty: (id) => p.data.counterparties.find((c) => c.id === id)?.name,
  };

  /** «Изменить в перевод» (§6.8): форма на месте становится переводом; на сервер уходит только по «Сохранить изменения». */
  const convert = () => {
    const r = convertToTransferDraft(draft, convertNames);
    setDraft(r.draft);
    setCarried(r.carried);
    setConvertLosses(null);
    // проект перевода — в блоке строки 3: раскрыть, если проект остался (у разбиения он был в строках)
    if (r.draft.projectId !== null) setMore(true);
    setErrors({});
    setFormError(null);
    setStatus(null);
    setMissingRate(null);
    setConvertFocus((n) => n + 1);
  };

  /** Строка «Изменить в перевод»: если что-то будет убрано — сначала подтверждение, иначе сразу (§6.8). */
  const askConvert = () => {
    const { losses } = convertToTransferDraft(draft, convertNames);
    if (losses.length > 0) setConvertLosses(losses);
    else convert();
  };

  /** «Разделить платёж» / «Отменить разделение» (§6.7, строка 2): разбиение — на месте категории. */
  const toggleSplit = () => {
    if (draft.split) {
      set({ split: null, categoryId: draft.split.lines[0]?.categoryId ?? null, projectId: draft.split.lines[0]?.projectId ?? null }, 'lines');
    } else set({ split: startSplit(draft.categoryId, draft.projectId, draft.amount) }, 'lines');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    void submit('close');
  };

  if (!op && activeAccounts.length === 0) {
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

  // data-field — куда поставить фокус после «Изменить в перевод» (пустой счёт перевода); contents — сетка формы не меняется
  const accountField = (label: string, key: 'accountId' | 'toAccountId') => (
    <div data-field={key} className="contents">
      <ComboSelect
        label={label}
        listLabel="Счета"
        value={draft[key]}
        options={accountOptions(p.data.accounts, draft[key])}
        emptyLabel={null}
        // доход, изменённый в перевод: «Со счёта» в другой валюте очищает сумму списания (§6.8, pickConvertedFrom)
        onChange={(id) => (key === 'accountId' && carried !== null ? pickFromAccount(id, carried) : set({ [key]: id }, key))}
        error={errors[key]}
        disabled={!!locked}
        hint={lockHint}
        autoFocus={focusField === key}
      />
    </div>
  );

  /** Дата и время оплаты (§2.3, §6.5 этапа 1.5): у перевода — первым полем, у дохода и расхода — после контрагента. */
  const paidDateField = (
    <DateTimeField
      label={labels.paidDate}
      date={paidDate}
      // то время, которое сохранится (shownPaidTime): «сейчас», время операции или заданное руками
      time={shownPaidTime({ ...draft, paidDate }, clock.time, clock.today, op ? dayOf(op.paidAt, p.timeZone) : null)}
      nowTime={clock.time}
      today={clock.today}
      originalDate={op ? dayOf(op.paidAt, p.timeZone) : null}
      editing={op !== null}
      error={errors.paidAt}
      hint={lockHint}
      disabled={!!locked}
      // «сегодня», выбранное в нетронутой дате, ничего не меняет: дата и так следует за «сегодня» (R5)
      onDateChange={(picked) =>
        !draft.paidDateSet && picked === clock.today
          ? undefined
          : set({ paidDate: picked, paidDateSet: true }, 'paidAt')
      }
      // время руками закрепляет и показанную дату — иначе после полуночи дата уйдёт на завтра, а время окажется в будущем
      onTimeChange={(paidTime) => set({ paidTime, paidTimeSet: true, paidDate, paidDateSet: true }, 'paidAt')}
    />
  );

  const amountField = (
    <AmountField
      label={`Сумма, ${currency.symbol}`}
      value={draft.amount}
      onChange={(amount) => set({ amount }, 'amount')}
      minorUnits={currency.minorUnits}
      error={errors.amount}
      autoFocus={focusField === 'amount'}
      refocusSignal={refocusAmount}
      disabled={!!locked}
      hint={lockHint}
    />
  );

  /** «Дата сделки» вместо строки «Дата сделки отличается» (§6.7, строка 1); «✕» возвращает строку. */
  const accrualField = (
    <div data-accrual-field="" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-b border-field py-2">
      <DateField label="Дата сделки" value={draft.accrualDate} today={today} floating error={errors.accrualDate} onChange={(accrualDate) => set({ accrualDate }, 'accrualDate')} />
      {!readOnly && (
        <button
          type="button"
          aria-label="Убрать дату сделки"
          title="Убрать дату сделки"
          onClick={() => {
            set({ accrualOn: false, accrualDate: accrualBefore.current ?? initial.accrualDate }, 'accrualDate');
            setAccrualFocus('row');
          }}
          className={`${btnIcon} mt-3`}
        >
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );

  /** Блок строки «Добавить проект, тег, комментарий, файл» — в одну колонку (§6.7, строка 3). */
  const moreBlock = (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-b border-field py-3">
      {!draft.split && (
        <ComboSelect
          label="Проект"
          listLabel="Проекты"
          value={draft.projectId}
          options={projectOptions(p.data.projects, [draft.projectId])}
          emptyLabel="Без проекта"
          onChange={(projectId) => set({ projectId }, 'lines')}
          onCreate={(name) => createItem('project', name, (d, projectId) => ({ ...d, projectId }))}
          createNoun="проект"
          error={transfer ? errors.lines : undefined}
        />
      )}
      <TagsField
        tags={p.data.tags}
        value={draft.tagIds}
        onChange={(tagIds) => set({ tagIds }, 'tagIds')}
        onCreate={(name) => createItem('tag', name, (d, id) => ({ ...d, tagIds: [...d.tagIds, id] }))}
        error={errors.tagIds}
      />
      <Field label="Комментарий" error={errors.comment} floating filled={draft.comment !== ''}>
        {(c) => (
          <textarea
            {...c}
            rows={2}
            maxLength={COMMENT_MAX}
            value={draft.comment}
            onChange={(e) => set({ comment: e.target.value }, 'comment')}
            className={floatingTextareaClass}
          />
        )}
      </Field>
      <AttachmentsField companyId={p.company.id} operationId={op?.id ?? null} pending={files} onPendingChange={setFiles} readOnly={readOnly} incoming={incoming} onIncomingHandled={() => setIncoming(null)} saving={pending} />
    </div>
  );

  /**
   * Строки-действия (§6.7 этапа 1.5) в порядке Finmap: 1 «Дата сделки отличается», 2 «Разделить платёж», 3 «Добавить
   * проект, тег, комментарий, файл» (его блок — сразу под ней), 4 «Изменить в перевод» (правка дохода и расхода, §6.8),
   * 5 «Дублировать платёж», 6 «Удалить платёж». У перевода — 3, 5, 6.
   */
  const rows = (
    <div>
      {!transfer &&
        (salary ? (
          <SalaryRow
            {...salaryRowText(salary.name, draft.accrualOn ? draft.accrualDate : null, paidDate)}
            selectedMonth={draft.accrualOn ? draft.accrualDate.slice(0, 7) : null}
            activeMonth={(draft.accrualOn ? draft.accrualDate : paidDate).slice(0, 7)}
            onPick={(accrualDate) => set({ accrualOn: true, accrualDate }, 'accrualDate')}
            // дата сделки возвращается к исходной: иначе «Как дата оплаты» оставила бы форму «грязной» с невидимой датой
            onClear={() => set({ accrualOn: false, accrualDate: initial.accrualDate }, 'accrualDate')}
            error={errors.accrualDate}
          />
        ) : draft.accrualOn ? (
          accrualField
        ) : (
          <ActionRow
            buttonRef={accrualRowRef}
            icon={<CalendarIcon />}
            label="Дата сделки отличается"
            info="Дата начисления для отчёта о прибылях и убытках"
            onClick={() => {
              // прежняя дата сделки запоминается: «✕» вернёт форму точно в прежнее состояние (она не «грязная»)
              accrualBefore.current = draft.accrualDate;
              set({ accrualOn: true, accrualDate: paidDate }, 'accrualDate');
              setAccrualFocus('field');
            }}
          />
        ))}
      {!transfer && <ActionRow icon={<SplitIcon />} label={draft.split ? 'Отменить разделение' : 'Разделить платёж'} onClick={toggleSplit} />}
      <ActionRow icon={<ChevronIcon up={more} />} label="Добавить проект, тег, комментарий, файл" expanded={more} onClick={() => setMore((v) => !v)} />
      {more && moreBlock}
      {op && !transfer && (
        <ActionRow
          icon={<TransferIcon />}
          label="Изменить в перевод"
          onClick={askConvert}
          disabledHint={convertBlockedHint(locked, p.data.accounts, draft.accountId)}
        />
      )}
      {op && <ActionRow icon={<CopyIcon />} label="Дублировать платёж" onClick={duplicate} />}
      {op && (
        <ActionRow
          icon={<TrashIcon />}
          label="Удалить платёж"
          danger
          onClick={() => setConfirmDelete(true)}
          disabledHint={locked ? `Удалить нельзя: ${LOCKED_HINT} («${locked.name}»)` : undefined}
        />
      )}
    </div>
  );

  return (
    <>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        noValidate
        aria-label="Операция"
        onDragOver={(e) => {
          if (!isFileDrag([...e.dataTransfer.types])) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = readOnly ? 'none' : 'copy';
        }}
        onDrop={(e) => {
          if (!isFileDrag([...e.dataTransfer.types])) return;
          e.preventDefault();
          if (readOnly) return;
          // бросили не в зону файлов: блок раскрывается и файлы добавляются так же, как из зоны
          setMore(true);
          setIncoming([...e.dataTransfer.files]);
        }}
        className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {readOnly && <p className={`${noticeClass} mb-0`}>Компания в архиве — изменения недоступны.</p>}
        {/* пока запрос идёт, поля недоступны: «похожий» копирует ровно то, что ушло на сервер */}
        <fieldset disabled={pending || readOnly} className="contents">
          {/* порядок полей — как в Finmap (§6.2 этапа 1.5); у перевода дата первой */}
          {transfer && paidDateField}
          {accountField(labels.account, 'accountId')}
          {transfer && accountField('На счёт', 'toAccountId')}
          {transfer ? (
            amountField
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              {amountField}
              <CurrencyBadge code={currency.code} symbol={currency.symbol} />
            </div>
          )}
          {crossCurrency && toCurrency && (
            <AmountField
              label={`Сумма зачисления, ${toCurrency.symbol}`}
              value={draft.toAmount}
              onChange={(toAmount) => set({ toAmount }, 'toAmount')}
              minorUnits={toCurrency.minorUnits}
              error={errors.toAmount}
              disabled={!!locked}
              hint={lockHint ?? (draft.accountId === null ? undefined : rateHint(draft, currency.code, currency.minorUnits, toCurrency.code, toCurrency.minorUnits))}
            />
          )}
          {!transfer &&
            (draft.split ? (
              <SplitEditor
                companyId={p.company.id}
                kind={kind}
                value={draft.split}
                onChange={(split) => set({ split }, 'lines')}
                total={amountMinor}
                currency={currency.code}
                minorUnits={currency.minorUnits}
                categories={p.data.categories}
                projects={p.data.projects}
                presets={p.data.presets}
                error={errors.lines}
                onCreateCategory={createLine('categoryId')}
                onCreateProject={createLine('projectId')}
                onFocusLost={() => setRefocusAmount((n) => n + 1)}
              />
            ) : (
              <ComboSelect
                label="Категория"
                listLabel="Категории"
                value={draft.categoryId}
                options={categoryOptions(p.data.categories, kind, [draft.categoryId])}
                emptyLabel="Без категории"
                onChange={(categoryId) => set({ categoryId }, 'lines')}
                onCreate={(name) => createItem('category', name, (d, categoryId) => ({ ...d, categoryId }))}
                createNoun="категорию"
                error={errors.lines}
              />
            ))}
          {!transfer && (
            <ComboSelect
              label={counterpartyLabel(p.data.categories, mainCategory)}
              listLabel="Контрагенты"
              value={draft.counterpartyId}
              options={counterpartyOptions(p.data.counterparties, draft.counterpartyId, preferredCounterpartyType(p.data.categories, mainCategory))}
              emptyLabel="Без контрагента"
              // оплаты относились к поступлениям прежнего поставщика
              onChange={(counterpartyId) => set({ counterpartyId, stockPayments: [] }, 'counterpartyId', 'stockPayments')}
              onCreate={(name) => createItem('counterparty', name, (d, counterpartyId) => ({ ...d, counterpartyId, stockPayments: [] }))}
              createNoun="контрагента"
              error={errors.counterpartyId}
            />
          )}
          {stockPaymentsField && draft.counterpartyId !== null && (
            <StockPaymentsField
              key={draft.counterpartyId}
              companyId={p.company.id}
              supplierId={draft.counterpartyId}
              operationId={op?.id ?? null}
              currency={p.company.baseCurrency}
              timeZone={p.timeZone}
              payments={draft.stockPayments}
              amount={amountMinor}
              onAmount={(amount) => set({ amount }, 'amount')}
              onChange={(stockPayments) => set({ stockPayments }, 'stockPayments')}
              error={errors.stockPayments}
            />
          )}
          {stockPaymentsDropped && (
            <p role="status" className="text-sm text-muted">
              Оплата закупки снимется
            </p>
          )}
          {!transfer && paidDateField}
          {readOnly ? (
            // архивная компания: только поля, без строк-действий (§6.7)
            <>
              {!transfer &&
                (salary ? (
                  <SalaryRow
                    {...salaryRowText(salary.name, draft.accrualOn ? draft.accrualDate : null, paidDate)}
                    selectedMonth={draft.accrualOn ? draft.accrualDate.slice(0, 7) : null}
                    activeMonth={(draft.accrualOn ? draft.accrualDate : paidDate).slice(0, 7)}
                    onPick={() => undefined}
                    onClear={() => undefined}
                    error={errors.accrualDate}
                    disabled
                  />
                ) : (
                  draft.accrualOn && accrualField
                ))}
              {moreBlock}
            </>
          ) : (
            rows
          )}
        </fieldset>

        {missingRate && <RateFix missing={missingRate} companyId={p.company.id} pending={pending} onRetry={() => void submit(lastThen.current)} />}
        {conflict && (
          <div role="alert" className={`${alertClass} mb-0 flex flex-wrap items-center justify-between gap-2`}>
            <span>{conflict === 'changed' ? 'Операция изменена другим пользователем' : 'Операция удалена другим пользователем'}</span>
            {conflict === 'changed' ? (
              <button type="button" disabled={pending} onClick={() => void reload()} className="font-semibold underline">
                Загрузить актуальную
              </button>
            ) : (
              <button type="button" onClick={p.close} className="font-semibold underline">
                Закрыть
              </button>
            )}
          </div>
        )}
        {formError && (
          <p role="alert" className={`${alertClass} mb-0`}>
            {formError}
          </p>
        )}
        {/* область role="status" есть всегда — меняется только текст, так его объявляют программы чтения с экрана */}
        <p role="status" className={status ? 'rounded-xl bg-income-soft px-4 py-3 text-sm text-income' : 'sr-only'}>
          {status}
        </p>

        {/* в архивной форме кнопок нет: закрывает только «×» окна, как в Finmap */}
        {!readOnly && (
          <div className="grid justify-items-center gap-1">
            <button type="submit" disabled={pending} className={SUBMIT_CLASS[draft.type]}>
              {submitLabel(draft.type, op !== null)}
            </button>
            {/* «создать похожий» — только при создании; при правке его роль — «Дублировать платёж» (§6.9) */}
            {!op && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void submit('similar')}
                className="flex items-center gap-2 rounded-lg px-3 py-2 font-semibold text-ink hover:bg-canvas disabled:opacity-50"
              >
                <span aria-hidden="true" className="text-xl leading-none text-muted">
                  +
                </span>
                Добавить и создать похожий
              </button>
            )}
          </div>
        )}
      </form>
      <ConfirmDialog
        open={confirmClose}
        title="Ваши данные не сохранятся"
        text="Закрыть окно? Введённые данные будут потеряны."
        confirmLabel="Закрыть"
        checkbox={{ label: 'Больше не спрашивать', checked: dontAsk, onChange: setDontAsk }}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          // сбой сохранения настройки не мешает закрыть окно: в следующий раз просто спросят снова
          if (dontAsk) savePreference(SKIP_CLOSE_CONFIRM_PREF, true).catch(() => undefined);
          p.close();
        }}
        // «×» или поле, с которого спросили, исчезли — фокус в поле суммы
        onFocusLost={() => setRefocusAmount((n) => n + 1)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Удалить платёж?"
        text="Операция будет удалена из журнала и итогов."
        confirmLabel="Удалить"
        danger
        pending={pending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void remove()}
        onFocusLost={() => setRefocusAmount((n) => n + 1)}
      />
      <ConfirmDialog
        open={convertLosses !== null}
        title="Изменить в перевод?"
        text={convertQuestion(convertLosses ?? [])}
        confirmLabel="Изменить"
        onCancel={() => setConvertLosses(null)}
        onConfirm={convert}
        // строки «Изменить в перевод» после перестройки нет — фокус на пустой счёт перевода
        onFocusLost={() => setConvertFocus((n) => n + 1)}
      />
    </>
  );
}

/**
 * «Валюта» рядом с суммой (§6.2 этапа 1.5): неактивный значок валюты счёта (пока счёт не выбран — базовой валюты
 * компании, как в Finmap) — ввод в другой валюте не делается (§1).
 */
function CurrencyBadge(props: { code: string; symbol: string }) {
  return (
    <div className="flex h-14 flex-col justify-center rounded-xl bg-field px-4">
      <span className="text-xs text-label">Валюта</span>
      <span className="whitespace-nowrap">
        {props.code} ({props.symbol})
      </span>
    </div>
  );
}

/** Подсказка у «Суммы зачисления»: курс из двух сумм, когда обе введены. */
function rateHint(draft: OperationDraft, from: string, fromMinor: number, to: string, toMinor: number): string | undefined {
  const a = positiveAmount(draft.amount, fromMinor);
  const b = positiveAmount(draft.toAmount, toMinor);
  const text = a.ok && b.ok ? transferRateText(a.minor, from, b.minor, to) : null;
  return text ? `Курс: ${text}` : undefined;
}

/**
 * Теги (§6.7 строка 3 этапа 1.5): поле-мультивыбор — выбранные плашками внутри поля с плавающей подписью «Теги»,
 * печать ищет и добавляет («+ Создать тег „…“» — новый тег; не удалось — набранное название остаётся в поле). Выбор
 * пункта добавляет тег и закрывает список; Backspace в пустом поле при закрытом списке убирает последний тег (не при
 * автоповторе клавиши); «×» на плашке убирает её тег, фокус уходит на «×» следующей плашки, иначе предыдущей, иначе
 * в поле. Добавление и удаление объявляет скрытая область `role="status"`.
 */
function TagsField(props: { tags: Tag[]; value: number[]; onChange: (ids: number[]) => void; onCreate: (name: string) => Promise<boolean>; error?: string }) {
  const names = new Map(props.tags.map((t) => [t.id, t.name]));
  const options = tagOptions(props.tags, props.value).filter((o) => !props.value.includes(o.id));
  const combo = useComboList({
    listLabel: 'Теги',
    options,
    selectedId: null,
    text: '',
    onPick: (id) => props.onChange([...props.value, id]),
    onCreate: props.onCreate,
    createNoun: 'тег',
  });
  const { onKeyDown, ...inputProps } = combo.inputProps;
  const removeButtons = useRef(new Map<number, HTMLButtonElement>());
  /** Куда вернуть фокус после удаления плашки «×»: «×» соседней плашки или поле. */
  const refocus = useRef<number | 'input' | null>(null);
  useEffect(() => {
    const target = refocus.current;
    if (target === null) return;
    const el = target === 'input' ? combo.inputProps.ref.current : (removeButtons.current.get(target) ?? null);
    if (el) {
      el.focus();
      refocus.current = null;
    }
  });
  // объявления: имена тегов, когда-либо виденные (убранный тег уже нет в списке выбранных), и очередь ещё не объявленного
  const known = useRef(new Map<number, string>());
  for (const [id, name] of names) known.current.set(id, name);
  const previous = useRef(props.value);
  const queue = useRef<{ id: number; added: boolean }[]>([]);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const before = previous.current;
    previous.current = props.value;
    for (const id of props.value) if (!before.includes(id)) queue.current.push({ id, added: true });
    for (const id of before) if (!props.value.includes(id)) queue.current.push({ id, added: false });
    const ready = queue.current.filter((q) => known.current.has(q.id));
    if (ready.length === 0) return;
    queue.current = queue.current.filter((q) => !known.current.has(q.id));
    setAnnouncement(ready.map((q) => `Тег ${known.current.get(q.id)} ${q.added ? 'добавлен' : 'убран'}`).join('. '));
  });
  return (
    <Field label="Теги" error={props.error} floating filled={props.value.length > 0 || combo.open} boxRef={combo.anchorRef}>
      {(control) => (
        <div className="flex min-h-14 flex-wrap items-center gap-1.5 rounded-xl bg-field px-4 pt-5 pb-1 focus-within:ring-2 focus-within:ring-focus">
          {props.value.length > 0 && (
            <ul role="list" aria-label="Выбранные теги" className="contents">
              {props.value.map((id, at) => (
                <li key={id} className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-0.5 text-sm">
                  {names.get(id) ?? '…'}
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) removeButtons.current.set(id, el);
                      else removeButtons.current.delete(id);
                    }}
                    aria-label={`Убрать тег «${names.get(id) ?? ''}»`}
                    onClick={() => {
                      refocus.current = props.value[at + 1] ?? props.value[at - 1] ?? 'input';
                      props.onChange(props.value.filter((x) => x !== id));
                    }}
                    className="text-muted hover:text-ink"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            {...control}
            {...inputProps}
            onKeyDown={(e) => {
              // Backspace в пустом поле при закрытом списке убирает последний тег (удержание клавиши не стирает все)
              if (e.key === 'Backspace' && !e.repeat && !combo.open && e.currentTarget.value === '' && props.value.length > 0) props.onChange(props.value.slice(0, -1));
              onKeyDown(e);
            }}
            className="min-w-24 flex-1 bg-transparent py-0.5 text-base outline-none"
          />
          {combo.list}
          <span role="status" className="sr-only">
            {announcement}
          </span>
        </div>
      )}
    </Field>
  );
}
