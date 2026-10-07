import { useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import { ColumnsPicker } from '../components/journal/ColumnsPicker';
import { FilterDialog } from '../components/journal/FilterDialog';
import { JournalTable, type JournalLookups } from '../components/journal/JournalTable';
import { JournalToolbar } from '../components/journal/JournalToolbar';
import { LoadMore } from '../components/journal/LoadMore';
import { Pending, StaleNotice } from '../components/QueryState';
import { btnSecondary, btnSmall } from '../components/ui';
import { JOURNAL_COLUMNS_PREF, visibleColumns } from '../lib/journal-columns';
import { applyDialogFields, filterConditionCount, isFiltered, journalApiParams, journalSearch, parseJournalSearch, type JournalUrlState } from '../lib/journal-filter';
import { uniqueById } from '../lib/journal-format';
import { useMeta } from '../lib/query';
import { useAccounts, useCategories, useCounterparties, useJournal, usePreferences, useProjects, useTags, type CategoryTree, type Company } from '../lib/queries';
import type { CompanyOutletContext } from './CompanyLayout';

/** Статьи плоским списком для ячеек: «Родитель», «Родитель → Дочерняя». */
function categoryNames(tree: CategoryTree): Map<number, string> {
  const names = new Map<number, string>();
  for (const node of [...tree.income, ...tree.expense]) {
    names.set(node.id, node.name);
    for (const child of node.children) names.set(child.id, `${node.name} → ${child.name}`);
  }
  return names;
}

/**
 * Журнал операций (§7): фильтр — в адресной строке (`?account=5` из левой панели), бесконечная прокрутка.
 * Маршрут не пересоздаёт страницу при смене компании, поэтому экран компании — с key: окно «Фильтр»,
 * выделение и сообщения начинаются заново.
 */
export function JournalPage() {
  const { company } = useOutletContext<CompanyOutletContext>();
  return <JournalScreen key={company.id} company={company} />;
}

function JournalScreen({ company }: { company: Company }) {
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
  if (!lookups || !tags.data || !timeZone || !today) return <Pending queries={lookupQueries} />;
  if (!journal.data && !journal.error) return <Pending queries={[...lookupQueries, journal]} />;

  // фильтр меняет адрес без новой записи в истории браузера: «Назад» уводит со страницы, а не по шагам фильтра
  const update = (next: JournalUrlState) => setParams(journalSearch(next), { replace: true });
  // повторы по id (операция изменилась на другой странице во время прокрутки) — иначе ключи строк совпадут
  const items = uniqueById(journal.data?.pages.flatMap((p) => p.items) ?? []);
  const columns = visibleColumns(prefs.data?.[JOURNAL_COLUMNS_PREF]);
  const conditions = filterConditionCount(state);

  return (
    <section>
      {/* ошибка следующей страницы — у «Показать ещё»: плашка с тем же сообщением не нужна */}
      <StaleNotice queries={journal.isFetchNextPageError || !journal.data ? lookupQueries : [...lookupQueries, journal]} />
      <h1 tabIndex={-1} className="mb-4 text-2xl font-bold outline-none">
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
      />
      {!journal.data ? (
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
