import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { todayInTimezone } from '../../shared/dates';
import type { JournalLookups } from '../components/journal/JournalTable';
import { categoryLookup } from './journal-format';
import { useMeta } from './query';
import { useAccounts, useCategories, useCounterparties, useProjects, useTags, type Company } from './queries';
import { dropUnknownIds, parseReportSearch, reportSearch, usesIds, type KnownIds, type ReportUrlState } from './report-url';
import { useStockWarehouses } from './stock';

/**
 * Настройки страницы отчёта «Аналитики» (§2.2 спецификации «Аналитика»): адрес → настройки (normalize оставляет те, что
 * есть у отчёта), справочники компании, проверка id из адреса, склад и сегодняшняя дата. Общие у всех отчётов.
 * - id из адреса, которых нет в справочниках (удалённый счёт, чужая ссылка), убираются до запроса — иначе 400 без выхода
 *   (R14): адрес исправляется, над отчётом — уведомление.
 * - stock — у отчёта есть переключатель склада (§5.3): склады компании запрашиваются только тогда; без склада `stock=0`
 *   из адреса не действует.
 * - ready — запрос отчёта можно строить: есть дата, id проверены, склады известны.
 * - update — новые настройки в адрес без новой записи в истории: «Назад» уводит со страницы, а не по шагам настроек.
 */
export function useReportSettings(company: Company, opts: { stock: boolean; normalize?: (s: ReportUrlState) => ReportUrlState }) {
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const accounts = useAccounts(company.id);
  const categories = useCategories(company.id);
  const projects = useProjects(company.id);
  const counterparties = useCounterparties(company.id);
  const tags = useTags(company.id);
  const warehouses = useStockWarehouses(company.id, opts.stock);
  const normalize = opts.normalize;
  const parsed = useMemo(() => (normalize ? normalize(parseReportSearch(params)) : parseReportSearch(params)), [params, normalize]);
  const cleaned = useMemo(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data || !tags.data) return null;
    const known: KnownIds = {
      accountIds: new Set(accounts.data.map((x) => x.id)),
      categoryIds: new Set(categoryLookup(categories.data).keys()),
      projectIds: new Set(projects.data.map((x) => x.id)),
      counterpartyIds: new Set(counterparties.data.map((x) => x.id)),
      tagIds: new Set(tags.data.map((x) => x.id)),
    };
    return dropUnknownIds(parsed, known);
  }, [parsed, accounts.data, categories.data, projects.data, counterparties.data, tags.data]);
  const stockAvailable = opts.stock && (warehouses.data?.length ?? 0) > 0;
  const stockKnown = !opts.stock || warehouses.data !== undefined || warehouses.isError;
  const raw = cleaned?.state ?? parsed;
  const state = !stockAvailable && !raw.stock ? { ...raw, stock: true } : raw;
  const timeZone = meta.data?.timezone;
  const today = timeZone ? todayInTimezone(timeZone) : null;
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!cleaned || cleaned.dropped.length === 0) return;
    setNotice(`Из ссылки убраны фильтры, которых больше нет: ${cleaned.dropped.join(', ')}`);
    setParams(reportSearch(cleaned.state), { replace: true });
    // адрес исправляется один раз на каждую испорченную ссылку; setParams меняется вместе с адресом
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleaned]);
  const lookups = useMemo<JournalLookups | null>(() => {
    if (!accounts.data || !categories.data || !projects.data || !counterparties.data) return null;
    return {
      accounts: new Map(accounts.data.map((a) => [a.id, a])),
      categories: categoryLookup(categories.data),
      projects: new Map(projects.data.map((p) => [p.id, p.name])),
      counterparties: new Map(counterparties.data.map((c) => [c.id, c.name])),
    };
  }, [accounts.data, categories.data, projects.data, counterparties.data]);
  // push — выбор категории нажатием (план 2026-10-20, решение 9): запись в истории браузера, «Назад» снимает выбор
  const update = (next: ReportUrlState, opts: { push?: boolean } = {}) => {
    setNotice('');
    setParams(reportSearch(next), { replace: !opts.push });
  };
  return {
    state,
    today,
    timeZone,
    ready: today !== null && stockKnown && (cleaned !== null || !usesIds(parsed)),
    stockAvailable,
    notice,
    update,
    lookups,
    /** Справочники для «Загрузка…» и ошибок до первого ответа. */
    dictionaries: [meta, accounts, categories, projects, counterparties, tags],
    accounts: accounts.data,
    filterData:
      accounts.data && categories.data && projects.data && counterparties.data && tags.data
        ? { accounts: accounts.data, categories: categories.data, projects: projects.data, counterparties: counterparties.data, tags: tags.data }
        : null,
  };
}
