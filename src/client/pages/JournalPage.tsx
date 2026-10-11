import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { AssignChip, AssignDialog, rowOpenButton, type AssignRequest } from '../components/journal/AssignDialog';
import { BulkBar } from '../components/journal/BulkBar';
import { BulkEditDialog } from '../components/journal/BulkEditDialog';
import { FilterButton } from '../components/journal/FilterButton';
import { JournalCards } from '../components/journal/JournalCards';
import { FilterDialog } from '../components/journal/FilterDialog';
import { unavailableText } from '../components/journal/SavedFiltersMenu';
import { UndoToast } from '../components/journal/UndoToast';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { useOpenOperationForm } from '../components/operation/OperationFormHost';
import { Pending, StaleNotice } from '../components/QueryState';
import { btnSecondary, noticeClass } from '../components/ui';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { api } from '../lib/api';
import {
  applyDialogFields,
  filterConditionCount,
  isFiltered,
  journalApiParams,
  journalSearch,
  parseJournalSearch,
  savedFilterFromState,
  stateFromSavedFilter,
  type DialogFields,
  type JournalUrlState,
} from '../lib/journal-filter';
import { categoryLookup, uniqueById } from '../lib/journal-format';
import { BULK_MAX, bulkEditSummary, bulkSummary, selectionTotals, type BulkAction, type BulkEditAction, type BulkResult, type BulkSummary } from '../lib/journal-bulk';
import { operationErrorText, refreshOperations, runBulk, useAssign } from '../lib/journal-mutations';
import { rememberJournal } from '../lib/last-journal';
import { journalWrap } from '../lib/preferences';
import { useIsMobile } from '../lib/media';
import { queryClient, useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, useSavedFilters, useTags, type Company } from '../lib/queries';
import type { CompanyOutletContext } from './CompanyLayout';

/** Фокус на кнопку открытия операции в строке (ячейка даты). */
function focusRowOpen(id: number): void {
  requestAnimationFrame(() => rowOpenButton(id)?.focus());
}

/** id заголовка «Журнал»: на него уходит фокус, когда закрывается тост. */
const HEADING_ID = 'journal-heading';

/** Итог «Отменить» виден в любой компании; название нужно, когда она не та, где восстановили. */
interface UndoSummary {
  companyId: number;
  companyName: string;
  summary: BulkSummary;
}

interface UndoState {
  key: number;
  /** Компания, где удалили: после смены компании «Отменить» восстанавливает операции именно в ней. */
  companyId: number;
  companyName: string;
  count: number;
  ids: number[];
}

/**
 * Журнал операций (§7): фильтр — в адресной строке (`?account=5` из левой панели), бесконечная прокрутка.
 * Маршрут не пересоздаёт страницу при смене компании, поэтому экран компании — с key: окно «Фильтр»,
 * выделение и сообщения начинаются заново. Тост «Удалено N — Отменить» живёт выше — он помнит компанию.
 */
export function JournalPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  const [toast, setToast] = useState<UndoState | null>(null);
  const [undoPending, setUndoPending] = useState(false);
  const [undoSummary, setUndoSummary] = useState<UndoSummary | null>(null);
  // не вышло: id и компания остаются здесь, «Повторить» работает и после тоста, и в другой компании
  const [undoFailure, setUndoFailure] = useState<{ state: UndoState; message: string } | null>(null);

  const undo = async (t: UndoState) => {
    // тост остаётся, пока идёт запрос: при ошибке «Отменить» должно остаться возможным
    setUndoPending(true);
    try {
      const result = await runBulk(t.companyId, t.ids, { action: 'restore' });
      setUndoFailure(null);
      setUndoSummary({ companyId: t.companyId, companyName: t.companyName, summary: bulkSummary('restore', result) });
    } catch (e) {
      setUndoFailure({ state: t, message: operationErrorText(e) });
    } finally {
      setToast((current) => (current && current.key === t.key ? null : current));
      setUndoPending(false);
    }
  };

  return (
    <>
      <JournalScreen
        key={company.id}
        company={company}
        onDeleted={(ids) => setToast({ key: Date.now(), companyId: company.id, companyName: company.name, count: ids.length, ids })}
        undoSummary={undoSummary}
        onClearUndoSummary={() => setUndoSummary(null)}
        undoFailure={undoFailure}
        undoPending={undoPending}
        onRetryUndo={() => undoFailure && void undo(undoFailure.state)}
        onDismissUndoFailure={() => setUndoFailure(null)}
      />
      <UndoToast
        toast={toast}
        pending={undoPending}
        onUndo={() => toast && void undo(toast)}
        onClose={() => setToast(null)}
        focusAfter={() => document.getElementById(HEADING_ID)}
      />
    </>
  );
}

function JournalScreen(props: {
  company: Company;
  onDeleted: (ids: number[]) => void;
  undoSummary: UndoSummary | null;
  onClearUndoSummary: () => void;
  undoFailure: { state: UndoState; message: string } | null;
  undoPending: boolean;
  onRetryUndo: () => void;
  onDismissUndoFailure: () => void;
}) {
  const { company } = props;
  // архивная компания — только чтение: ни «Указать», ни выделения, ни сохранения фильтра
  const readOnly = company.archivedAt !== null;
  // телефон (§7 «Мобильная версия»): карточки вместо таблицы, без выделения и «Указать»
  const mobile = useIsMobile();
  const meta = useMeta();
  const prefs = usePreferences();
  const [params, setParams] = useSearchParams();
  // «← Назад к журналу» в настройках возвращает сюда с тем же фильтром (§4.1 этапа 1.5)
  const location = useLocation();
  useEffect(() => rememberJournal(company.id, location.search), [company.id, location.search]);
  const state = useMemo(() => parseJournalSearch(params), [params]);
  const timeZone = meta.data?.timezone;
  const today = timeZone ? todayInTimezone(timeZone) : null;
  const journal = useJournal(company.id, today ? journalApiParams(state, today).toString() : null);
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const counterparties = useCounterparties(company.id);
  const tags = useTags(company.id);
  const [filterOpen, setFilterOpen] = useState(false);
  const openForm = useOpenOperationForm();
  const savedFilters = useSavedFilters(company.id);
  const openOperation = (item: { id: number }) => openForm({ kind: 'edit', id: item.id, focusAfterDelete: () => document.getElementById(HEADING_ID) });
  // предупреждение после применения сохранённого фильтра с недоступными ссылками (инвариант 10)
  const [notice, setNotice] = useState<string | null>(null);
  // ошибка «Указать» (конфликт версии, архив) — над таблицей, пока её не скроют или не начнут новое действие
  const [actionError, setActionError] = useState<string | null>(null);
  const assign = useAssign(company.id, setActionError);
  // «Указать» (§5.4): окно открыто для этой строки и поля
  const [assignRequest, setAssignRequest] = useState<AssignRequest | null>(null);
  // массовые действия: выделение (только загруженные строки), итог, тост отмены удаления (в JournalPage)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  // «Изменить данные» (§5.5): окно живёт на странице, а не в полосе — полоса исчезает вместе с выделением,
  // а открытый <dialog> нельзя просто убрать со страницы
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  // выделение опустело при открытом окне (другой фильтр, строки ушли из загруженных) — окно закрывается штатно
  useEffect(() => {
    if (selected.size === 0) setBulkEditOpen(false);
  }, [selected]);
  // итог без тоста (ничего не удалено) получает фокус: полоса действий исчезла вместе с выделением
  const summaryRef = useRef<HTMLDivElement>(null);
  const [focusSummary, setFocusSummary] = useState(false);
  useEffect(() => {
    if (!focusSummary) return;
    summaryRef.current?.focus();
    setFocusSummary(false);
  }, [focusSummary]);
  // выделение опустело (строки ушли из фильтра после «Изменить данные», удалены), полоса исчезла вместе с сфокусированным
  // элементом, и фокус на <body>: итог, если он показан, иначе «Выбрать все», иначе заголовок страницы
  const selectedBefore = useRef(0);
  useEffect(() => {
    const before = selectedBefore.current;
    selectedBefore.current = selected.size;
    if (before === 0 || selected.size > 0) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const target = summaryRef.current ?? document.querySelector<HTMLElement>('[data-select-all]') ?? document.getElementById(HEADING_ID);
    target?.focus();
  }, [selected]);
  // «Повторить» получает фокус, когда ошибка появилась, а не при каждой сборке экрана (смена компании)
  const retryRef = useRef<HTMLButtonElement>(null);
  const failureShown = useRef(props.undoFailure);
  useEffect(() => {
    if (props.undoFailure && props.undoFailure !== failureShown.current) retryRef.current?.focus();
    failureShown.current = props.undoFailure;
  }, [props.undoFailure]);
  // строка, которой только что назначили значение: если она ушла из фильтра, фокус не должен потеряться
  const assigned = useRef<{ id: number; index: number } | null>(null);
  // на телефоне массовых действий нет: выделение, сделанное в широком окне, снимается — невидимое не удалить по ошибке
  useEffect(() => {
    if (mobile) setSelected(new Set());
  }, [mobile]);
  const filterKey = params.toString();
  const prevFilterKey = useRef(filterKey);
  // другой фильтр — выделение и итоги снимаются (другая компания — новый экран, см. выше: итог её отмены переживает смену)
  useEffect(() => {
    setSelected(new Set());
    setSummary(null);
    assigned.current = null;
    if (prevFilterKey.current !== filterKey) {
      prevFilterKey.current = filterKey;
      props.onClearUndoSummary();
    }
  }, [filterKey]);
  // строка пропала из загруженных (удалена, ушла из фильтра) — выделение с неё снимается, а не возвращается вместе с ней
  const loadedIds = journal.data ? journal.data.pages.flatMap((p) => p.items.map((i) => i.id)).join(',') : null;
  useEffect(() => {
    if (loadedIds === null) return;
    const loaded = new Set(loadedIds.split(',').map(Number));
    setSelected((prev) => {
      const next = [...prev].filter((id) => loaded.has(id));
      return next.length === prev.size ? prev : new Set(next);
    });
  }, [loadedIds]);
  // назначенная строка ушла из выборки («Без категории»), и фокус остался на <body>: на строку, занявшую её место, или на заголовок
  useEffect(() => {
    const a = assigned.current;
    if (!a || loadedIds === null) return;
    const ids = loadedIds === '' ? [] : loadedIds.split(',').map(Number);
    if (ids.includes(a.id)) return;
    assigned.current = null;
    if (document.activeElement && document.activeElement !== document.body) return;
    const next = ids[a.index];
    if (next !== undefined) focusRowOpen(next);
    else document.getElementById(HEADING_ID)?.focus();
  }, [loadedIds]);

  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryLookup(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

  // один объект между перерисовками: от него зависят списки окон «Указать» и «Изменить данные»
  const assignData = useMemo(
    () => ({ categories: categories.data!, projects: projects.data!, counterparties: counterparties.data! }),
    [categories.data, projects.data, counterparties.data],
  );

  // справочники нужны всегда: без них журнал не показать. Ошибка самого журнала (например, после смены фильтра) — ниже, под тулбаром
  const lookupQueries = [meta, accounts, categories, projects, counterparties, tags];
  // без справочников журнал не показать; дальше тулбар на экране всегда — и пока грузится новый запрос журнала
  // (например, после ошибки и смены поиска): иначе поле поиска пропало бы вместе с фокусом
  if (!lookups || !tags.data || !timeZone || !today) return <Pending queries={lookupQueries} />;

  // фильтр меняет адрес без новой записи в истории браузера: «Назад» уводит со страницы, а не по шагам фильтра
  const update = (next: JournalUrlState) => setParams(journalSearch(next), { replace: true });
  // повторы по id (операция изменилась на другой странице во время прокрутки) — иначе ключи строк совпадут
  const items = uniqueById(journal.data?.pages.flatMap((p) => p.items) ?? []);
  const columns = visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]);
  const conditions = filterConditionCount(state);
  const selectedItems = items.filter((i) => selected.has(i.id));
  const selectedIds = selectedItems.map((i) => i.id);
  const undoShown = props.undoSummary;
  const otherCompany = (id: number) => id !== company.id;
  const shownSummary: BulkSummary | null = undoShown
    ? { ...undoShown.summary, text: otherCompany(undoShown.companyId) ? `Компания «${undoShown.companyName}»: ${undoShown.summary.text}` : undoShown.summary.text }
    : summary;
  const run = async (action: BulkAction, ids: number[]) => {
    setBulkPending(true);
    setActionError(null);
    setSummary(null);
    props.onClearUndoSummary();
    try {
      const result = await runBulk(company.id, ids, action);
      const done = bulkSummary(action.action, result);
      if (action.action === 'delete') {
        setSelected(new Set());
        if (result.changed.length > 0) props.onDeleted(result.changed);
        // тост уже объявил удаление: итог нужен, только если что-то пропущено или тоста нет
        if (result.changed.length === 0 || result.skipped.length > 0) setSummary(done);
        if (result.changed.length === 0) setFocusSummary(true);
      } else {
        setSummary(done);
      }
    } catch (e) {
      setActionError(operationErrorText(e));
    } finally {
      setBulkPending(false);
    }
  };
  // «Изменить данные» (§5.5): по очереди только заполненные поля; упал запрос — следующие не выполняются, итог это показывает
  const runEdit = async (actions: BulkEditAction[], ids: number[]) => {
    setBulkPending(true);
    setActionError(null);
    setSummary(null);
    props.onClearUndoSummary();
    const done: { action: BulkEditAction['action']; result: BulkResult }[] = [];
    let failed: { action: BulkEditAction['action']; message: string } | null = null;
    let next = 0;
    for (; next < actions.length; next++) {
      const action = actions[next]!;
      try {
        done.push({ action: action.action, result: await runBulk(company.id, ids, action) });
      } catch (e) {
        failed = { action: action.action, message: operationErrorText(e) };
        break;
      }
    }
    setSummary(bulkEditSummary(done, failed, failed ? actions.slice(next + 1).map((a) => a.action) : []));
    setBulkPending(false);
  };
  // сохраняются поля окна поверх ТЕКУЩЕГО фильтра — как у «Готово», без устаревшего поиска из снимка
  const saveFilter = async (draft: DialogFields, name: string) => {
    await api(`/companies/${company.id}/saved-filters`, { method: 'POST', body: { name, filter: savedFilterFromState(applyDialogFields(state, draft), today) } });
    await queryClient.invalidateQueries({ queryKey: ['saved-filters', company.id] });
  };

  return (
    <section>
      {/* ошибка следующей страницы — у «Показать ещё»: плашка с тем же сообщением не нужна */}
      <StaleNotice queries={journal.isFetchNextPageError || !journal.data ? lookupQueries : [...lookupQueries, journal]} />
      {/* заголовок дублировал вкладку «Журнал» (01-M2): виден только программам чтения, фокус после тостов — сюда */}
      <h1 id={HEADING_ID} tabIndex={-1} className="sr-only">
        Журнал
      </h1>
      {/* итог выделения для программ чтения (§5.5): область есть всегда, без выделения пустая — первый итог тоже объявляется */}
      <p id="selection-totals" aria-live="polite" className="sr-only">
        {!mobile && selectedItems.length > 0
          ? selectedItems.length > BULK_MAX
            ? `Не больше ${BULK_MAX} операций за раз — снимите часть выделения`
            : selectionTotals(selectedItems, company.baseCurrency)
          : ''}
      </p>
      <JournalToolbar
        state={state}
        onChange={update}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        today={today}
        mobile={mobile}
        filter={
          <FilterButton
            count={conditions}
            onOpen={() => setFilterOpen(true)}
            canSave={!readOnly}
            companyId={company.id}
            filters={savedFilters.data}
            onApply={(f) => {
              update(stateFromSavedFilter(f.filter, state));
              setNotice(f.unavailable > 0 ? `Фильтр «${f.name}»: ${unavailableText(f.unavailable)} (удалены или в архиве) — они не применены.` : null);
            }}
          />
        }
        // ⟳ (§2.5): загруженные страницы перечитываются на месте — таблица не размонтируется, прокрутка остаётся;
        // сбой перечитывания журнала «Ещё» показывает
        onRefresh={() => refreshOperations(company.id)}
        // колонки и «Показывать полностью» не сохранились, а «Ещё» уже закрыт — ошибку видно на странице
        onPrefError={setActionError}
      />
      <FilterDialog
        open={filterOpen}
        state={state}
        data={{ accounts: accounts.data!, categories: categories.data!, projects: projects.data!, counterparties: counterparties.data!, tags: tags.data }}
        // поля модалки — поверх текущего фильтра: поиск, дошедший до адреса при открытом окне, не теряется
        onApply={(draft) => update(applyDialogFields(state, draft))}
        onClose={() => setFilterOpen(false)}
        onSave={readOnly ? undefined : saveFilter}
      />
      {!readOnly && (
        <AssignDialog
          request={assignRequest}
          data={assignData}
          onClose={() => setAssignRequest(null)}
          onSave={({ item, field }, id) => {
            setAssignRequest(null);
            setActionError(null);
            assign.mutate({ item, field, id });
            // строка может уйти из выборки («Без категории»): эффект выше переведёт фокус на соседнюю
            assigned.current = { id: item.id, index: items.findIndex((i) => i.id === item.id) };
          }}
        />
      )}
      {!readOnly && (
        <BulkEditDialog
          open={bulkEditOpen}
          count={selectedIds.length}
          data={assignData}
          onClose={() => setBulkEditOpen(false)}
          onSave={(actions) => {
            setBulkEditOpen(false);
            void runEdit(actions, selectedIds);
          }}
          // окно закрылось, потому что выделение опустело: «Изменить данные» уже нет — фокус на «Выбрать все»
          // (если и таблицы нет — Modal поставит фокус на заголовок страницы)
          returnFocus={() => (selected.size === 0 ? document.querySelector<HTMLElement>('[data-select-all]') : null)}
        />
      )}
      {readOnly && <p className={noticeClass}>Компания в архиве — изменения недоступны.</p>}
      {props.undoFailure && (
        <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>
            Не удалось отменить удаление{otherCompany(props.undoFailure.state.companyId) ? ` в компании «${props.undoFailure.state.companyName}»` : ''}: {props.undoFailure.message}
          </span>
          <span className="flex gap-3">
            <button
              ref={retryRef}
              type="button"
              aria-disabled={props.undoPending}
              onClick={() => !props.undoPending && props.onRetryUndo()}
              className="font-semibold underline"
            >
              Повторить
            </button>
            <button type="button" onClick={props.onDismissUndoFailure} className="font-semibold underline">
              Скрыть
            </button>
          </span>
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {shownSummary && (
        <div ref={summaryRef} tabIndex={-1} role="status" className="mb-4 rounded-xl bg-field px-4 py-2 text-sm outline-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-semibold">{shownSummary.text}</span>
            <button
              type="button"
              onClick={() => {
                setSummary(null);
                props.onClearUndoSummary();
              }}
              className="font-semibold underline"
            >
              Скрыть
            </button>
          </div>
          {shownSummary.reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {shownSummary.reasons.map((r) => (
                <li key={r.reason}>
                  {r.reason} — {r.count}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {!journal.data && !journal.error ? (
        <p className="py-8 text-center text-muted">Загрузка…</p>
      ) : !journal.data ? (
        <div className="py-8 text-center">
          <p role="alert" className="mb-4 text-expense">
            {journal.error?.message}
          </p>
          <button type="button" onClick={() => void journal.refetch()} className={btnSecondary}>
            Повторить
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-muted">{isFiltered(state) ? 'По этому фильтру операций нет.' : 'Операций пока нет.'}</p>
      ) : mobile ? (
        <JournalCards
          items={items}
          lookups={lookups}
          baseCurrency={company.baseCurrency}
          timeZone={timeZone}
          today={today}
          busy={journal.isPlaceholderData}
          onOpenOperation={openOperation}
        />
      ) : (
        <JournalTable
          items={items}
          columns={columns}
          wrap={journalWrap(prefs.data)}
          lookups={lookups}
          baseCurrency={company.baseCurrency}
          timeZone={timeZone}
          today={today}
          projectFilter={state.projectIds}
          sort={state.sort}
          order={state.order}
          onSort={(sort, order) => update({ ...state, sort, order })}
          busy={journal.isPlaceholderData}
          onOpenOperation={openOperation}
          renderAssign={readOnly ? undefined : (item, field) => <AssignChip field={field} onClick={() => setAssignRequest({ item, field })} />}
          bulkBar={
            !mobile && selectedItems.length > 0 ? (
              <BulkBar
                items={selectedItems}
                baseCurrency={company.baseCurrency}
                pending={bulkPending}
                onRun={(action) => run(action, selectedIds)}
                onEdit={() => setBulkEditOpen(true)}
              />
            ) : undefined
          }
          selection={readOnly ? undefined : {
            selected,
            onToggle: (id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              }),
            onToggleAll: (select) => setSelected(select ? new Set(items.map((i) => i.id)) : new Set()),
          }}
        />
      )}
      {/* пока новый фильтр или сортировка грузятся, старые страницы — лишь заглушка: «ещё» к ним не относится */}
      {journal.data && !journal.isPlaceholderData && (
        <LoadMore
          hasNext={journal.hasNextPage}
          loading={journal.isFetchingNextPage}
          failed={journal.isFetchNextPageError}
          onLoad={() => void journal.fetchNextPage()}
        />
      )}
    </section>
  );
}
