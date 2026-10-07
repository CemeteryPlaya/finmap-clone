import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { AssignPicker } from '../components/journal/AssignPicker';
import { BulkBar } from '../components/journal/BulkBar';
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
import { FilterDialog } from '../components/journal/FilterDialog';
import { SavedFiltersMenu, unavailableText } from '../components/journal/SavedFiltersMenu';
import { UndoToast } from '../components/journal/UndoToast';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { btnSecondary, btnSmall } from '../components/ui';
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
import { uniqueById } from '../lib/journal-format';
import { bulkSummary, type BulkAction, type BulkSummary } from '../lib/journal-bulk';
import { operationErrorText, runBulk, useAssign } from '../lib/journal-mutations';
import { queryClient, useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, useSavedFilters, useTags, type CategoryTree, type Company } from '../lib/queries';
import type { CompanyOutletContext } from './CompanyLayout';

/** Фокус на строку операции (у строки tabIndex=-1 и data-operation-id). */
function focusRow(id: number): void {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`tr[data-operation-id="${id}"]`)?.focus());
}

/** Статьи плоским списком для ячеек: «Родитель», «Родитель → Дочерняя». */
function categoryNames(tree: CategoryTree): Map<number, string> {
  const names = new Map<number, string>();
  for (const node of [...tree.income, ...tree.expense]) {
    names.set(node.id, node.name);
    for (const child of node.children) names.set(child.id, `${node.name} → ${child.name}`);
  }
  return names;
}

/** id заголовка «Журнал»: на него уходит фокус, когда закрывается тост. */
const HEADING_ID = 'journal-heading';

interface UndoState {
  key: number;
  /** Компания, где удалили: после смены компании «Отменить» восстанавливает операции именно в ней. */
  companyId: number;
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
  const [undoSummary, setUndoSummary] = useState<{ companyId: number; summary: BulkSummary } | null>(null);

  const undo = async (t: UndoState) => {
    setToast(null);
    setUndoPending(true);
    try {
      setUndoSummary({ companyId: t.companyId, summary: bulkSummary('restore', await runBulk(t.companyId, t.ids, { action: 'restore' })) });
    } catch (e) {
      setUndoSummary({ companyId: t.companyId, summary: { text: operationErrorText(e), reasons: [] } });
    } finally {
      setUndoPending(false);
    }
  };

  return (
    <>
      <JournalScreen
        key={company.id}
        company={company}
        onDeleted={(ids) => setToast({ key: Date.now(), companyId: company.id, count: ids.length, ids })}
        undoSummary={undoSummary?.companyId === company.id ? undoSummary.summary : null}
        onClearUndoSummary={() => setUndoSummary(null)}
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
  undoSummary: BulkSummary | null;
  onClearUndoSummary: () => void;
}) {
  const { company } = props;
  const meta = useMeta();
  const prefs = usePreferences();
  const [params, setParams] = useSearchParams();
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
  const savedFilters = useSavedFilters(company.id);
  // предупреждение после применения сохранённого фильтра с недоступными ссылками (инвариант 10)
  const [notice, setNotice] = useState<string | null>(null);
  // ошибка «Указать» (конфликт версии, архив) — над таблицей, пока её не скроют или не начнут новое действие
  const [actionError, setActionError] = useState<string | null>(null);
  const assign = useAssign(company.id, setActionError);
  // массовые действия: выделение (только загруженные строки), итог, тост отмены удаления (в JournalPage)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [summary, setSummary] = useState<BulkSummary | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const filterKey = params.toString();
  // другой фильтр — выделение снимается (другая компания — новый экран, см. key выше)
  useEffect(() => setSelected(new Set()), [filterKey]);

  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryNames(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);

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
  const assignData = { categories: categories.data!, projects: projects.data!, counterparties: counterparties.data! };
  const selectedIds = items.filter((i) => selected.has(i.id)).map((i) => i.id);
  const shownSummary = props.undoSummary ?? summary;
  const run = async (action: BulkAction, ids: number[]) => {
    setBulkPending(true);
    setActionError(null);
    setSummary(null);
    props.onClearUndoSummary();
    try {
      const result = await runBulk(company.id, ids, action);
      setSummary(bulkSummary(action.action, result));
      if (action.action === 'delete') {
        setSelected(new Set());
        if (result.changed.length > 0) props.onDeleted(result.changed);
      }
    } catch (e) {
      setActionError(operationErrorText(e));
    } finally {
      setBulkPending(false);
    }
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
      <h1 id={HEADING_ID} tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
        Журнал
      </h1>
      <JournalToolbar
        state={state}
        onChange={update}
        companyId={company.id}
        baseCurrency={company.baseCurrency}
        today={today}
        actions={
          <>
            <button type="button" aria-haspopup="dialog" onClick={() => setFilterOpen(true)} className={btnSmall}>
              Фильтр{conditions > 0 && ` · ${conditions}`}
            </button>
            <SavedFiltersMenu
              companyId={company.id}
              filters={savedFilters.data}
              onApply={(f) => {
                update(stateFromSavedFilter(f.filter, state));
                setNotice(f.unavailable > 0 ? `Фильтр «${f.name}»: ${unavailableText(f.unavailable)} (удалены или в архиве) — они не применены.` : null);
              }}
            />
            <ColumnsPicker visible={columns} />
          </>
        }
      />
      <FilterDialog
        open={filterOpen}
        state={state}
        data={{ accounts: accounts.data!, categories: categories.data!, projects: projects.data!, counterparties: counterparties.data!, tags: tags.data }}
        // поля модалки — поверх текущего фильтра: поиск, дошедший до адреса при открытом окне, не теряется
        onApply={(draft) => update(applyDialogFields(state, draft))}
        onClose={() => setFilterOpen(false)}
        onSave={saveFilter}
      />
      {actionError && (
        <p role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-expense-soft px-4 py-2 text-sm text-expense">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="font-semibold underline">
            Скрыть
          </button>
        </p>
      )}
      {shownSummary && (
        <div role="status" className="mb-4 rounded-xl bg-field px-4 py-2 text-sm">
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
      {selectedIds.length > 0 && (
        <BulkBar count={selectedIds.length} data={assignData} pending={bulkPending} onRun={(action) => void run(action, selectedIds)} onClear={() => setSelected(new Set())} />
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
      ) : (
        <JournalTable
          items={items}
          columns={columns}
          lookups={lookups}
          baseCurrency={company.baseCurrency}
          timeZone={timeZone}
          today={today}
          projectFilter={state.projectIds}
          sort={state.sort}
          order={state.order}
          onSort={(sort, order) => update({ ...state, sort, order })}
          busy={journal.isPlaceholderData}
          renderAssign={(item, field) => (
            <AssignPicker
              item={item}
              field={field}
              data={assignData}
              onPick={(id) => {
                setActionError(null);
                assign.mutate({ item, field, id });
                // кнопка «Указать» исчезает вместе с пустой ячейкой — фокус на строку операции
                focusRow(item.id);
              }}
            />
          )}
          selection={{
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
