import * as pg from './schema-pg';
import * as sqlite from './schema-sqlite';

/**
 * Таблицы для сервисов (Р3 плана 2026-10-20-vercel-postgres): по типам — таблицы SQLite, на деле — таблицы диалекта,
 * к которому привязан процесс (bindSchema при открытии базы). Сервисы пишут один код для обоих диалектов; имена,
 * колонки и ключи совпадают (тест паритета).
 */
export type Dialect = 'sqlite' | 'pg';

export let users = sqlite.users;
export let sessions = sqlite.sessions;
export let auditLog = sqlite.auditLog;
export let auditUndo = sqlite.auditUndo;
export let currencies = sqlite.currencies;
export let companies = sqlite.companies;
export let projects = sqlite.projects;
export let accounts = sqlite.accounts;
export let categories = sqlite.categories;
export let counterparties = sqlite.counterparties;
export let tags = sqlite.tags;
export let splitPresets = sqlite.splitPresets;
export let userPreferences = sqlite.userPreferences;
export let exchangeRates = sqlite.exchangeRates;
export let fixedRates = sqlite.fixedRates;
export let imports = sqlite.imports;
export let operations = sqlite.operations;
export let operationLines = sqlite.operationLines;
export let operationTags = sqlite.operationTags;
export let attachments = sqlite.attachments;
export let savedFilters = sqlite.savedFilters;
export let stockItemGroups = sqlite.stockItemGroups;
export let stockItems = sqlite.stockItems;
export let stockItemPrices = sqlite.stockItemPrices;
export let stockComboParts = sqlite.stockComboParts;
export let stockWarehouses = sqlite.stockWarehouses;
export let stockDocs = sqlite.stockDocs;
export let stockDocLines = sqlite.stockDocLines;
export let stockBatches = sqlite.stockBatches;
export let stockAllocations = sqlite.stockAllocations;
export let stockDocPayments = sqlite.stockDocPayments;
export let stockDocPostings = sqlite.stockDocPostings;
export let analyticsIndicatorParts = sqlite.analyticsIndicatorParts;

export const sqliteTables = {
  users: sqlite.users,
  sessions: sqlite.sessions,
  auditLog: sqlite.auditLog,
  auditUndo: sqlite.auditUndo,
  currencies: sqlite.currencies,
  companies: sqlite.companies,
  projects: sqlite.projects,
  accounts: sqlite.accounts,
  categories: sqlite.categories,
  counterparties: sqlite.counterparties,
  tags: sqlite.tags,
  splitPresets: sqlite.splitPresets,
  userPreferences: sqlite.userPreferences,
  exchangeRates: sqlite.exchangeRates,
  fixedRates: sqlite.fixedRates,
  imports: sqlite.imports,
  operations: sqlite.operations,
  operationLines: sqlite.operationLines,
  operationTags: sqlite.operationTags,
  attachments: sqlite.attachments,
  savedFilters: sqlite.savedFilters,
  stockItemGroups: sqlite.stockItemGroups,
  stockItems: sqlite.stockItems,
  stockItemPrices: sqlite.stockItemPrices,
  stockComboParts: sqlite.stockComboParts,
  stockWarehouses: sqlite.stockWarehouses,
  stockDocs: sqlite.stockDocs,
  stockDocLines: sqlite.stockDocLines,
  stockBatches: sqlite.stockBatches,
  stockAllocations: sqlite.stockAllocations,
  stockDocPayments: sqlite.stockDocPayments,
  stockDocPostings: sqlite.stockDocPostings,
  analyticsIndicatorParts: sqlite.analyticsIndicatorParts,
};

export const pgTables = {
  users: pg.users,
  sessions: pg.sessions,
  auditLog: pg.auditLog,
  auditUndo: pg.auditUndo,
  currencies: pg.currencies,
  companies: pg.companies,
  projects: pg.projects,
  accounts: pg.accounts,
  categories: pg.categories,
  counterparties: pg.counterparties,
  tags: pg.tags,
  splitPresets: pg.splitPresets,
  userPreferences: pg.userPreferences,
  exchangeRates: pg.exchangeRates,
  fixedRates: pg.fixedRates,
  imports: pg.imports,
  operations: pg.operations,
  operationLines: pg.operationLines,
  operationTags: pg.operationTags,
  attachments: pg.attachments,
  savedFilters: pg.savedFilters,
  stockItemGroups: pg.stockItemGroups,
  stockItems: pg.stockItems,
  stockItemPrices: pg.stockItemPrices,
  stockComboParts: pg.stockComboParts,
  stockWarehouses: pg.stockWarehouses,
  stockDocs: pg.stockDocs,
  stockDocLines: pg.stockDocLines,
  stockBatches: pg.stockBatches,
  stockAllocations: pg.stockAllocations,
  stockDocPayments: pg.stockDocPayments,
  stockDocPostings: pg.stockDocPostings,
  analyticsIndicatorParts: pg.analyticsIndicatorParts,
};

let bound: Dialect | null = null;

/** Диалект процесса: первая привязка выбирает таблицы, повтор того же — без изменений, другой — ошибка. */
export function bindSchema(dialect: Dialect): void {
  if (bound === dialect) return;
  if (bound !== null) throw new Error(`Схема уже привязана к ${bound}: один процесс — один диалект`);
  bound = dialect;
  if (dialect === 'sqlite') return;
  users = pg.users as unknown as typeof sqlite.users;
  sessions = pg.sessions as unknown as typeof sqlite.sessions;
  auditLog = pg.auditLog as unknown as typeof sqlite.auditLog;
  auditUndo = pg.auditUndo as unknown as typeof sqlite.auditUndo;
  currencies = pg.currencies as unknown as typeof sqlite.currencies;
  companies = pg.companies as unknown as typeof sqlite.companies;
  projects = pg.projects as unknown as typeof sqlite.projects;
  accounts = pg.accounts as unknown as typeof sqlite.accounts;
  categories = pg.categories as unknown as typeof sqlite.categories;
  counterparties = pg.counterparties as unknown as typeof sqlite.counterparties;
  tags = pg.tags as unknown as typeof sqlite.tags;
  splitPresets = pg.splitPresets as unknown as typeof sqlite.splitPresets;
  userPreferences = pg.userPreferences as unknown as typeof sqlite.userPreferences;
  exchangeRates = pg.exchangeRates as unknown as typeof sqlite.exchangeRates;
  fixedRates = pg.fixedRates as unknown as typeof sqlite.fixedRates;
  imports = pg.imports as unknown as typeof sqlite.imports;
  operations = pg.operations as unknown as typeof sqlite.operations;
  operationLines = pg.operationLines as unknown as typeof sqlite.operationLines;
  operationTags = pg.operationTags as unknown as typeof sqlite.operationTags;
  attachments = pg.attachments as unknown as typeof sqlite.attachments;
  savedFilters = pg.savedFilters as unknown as typeof sqlite.savedFilters;
  stockItemGroups = pg.stockItemGroups as unknown as typeof sqlite.stockItemGroups;
  stockItems = pg.stockItems as unknown as typeof sqlite.stockItems;
  stockItemPrices = pg.stockItemPrices as unknown as typeof sqlite.stockItemPrices;
  stockComboParts = pg.stockComboParts as unknown as typeof sqlite.stockComboParts;
  stockWarehouses = pg.stockWarehouses as unknown as typeof sqlite.stockWarehouses;
  stockDocs = pg.stockDocs as unknown as typeof sqlite.stockDocs;
  stockDocLines = pg.stockDocLines as unknown as typeof sqlite.stockDocLines;
  stockBatches = pg.stockBatches as unknown as typeof sqlite.stockBatches;
  stockAllocations = pg.stockAllocations as unknown as typeof sqlite.stockAllocations;
  stockDocPayments = pg.stockDocPayments as unknown as typeof sqlite.stockDocPayments;
  stockDocPostings = pg.stockDocPostings as unknown as typeof sqlite.stockDocPostings;
  analyticsIndicatorParts = pg.analyticsIndicatorParts as unknown as typeof sqlite.analyticsIndicatorParts;
}

/** Диалект, к которому привязан процесс (по умолчанию — SQLite). */
export function currentDialect(): Dialect {
  return bound ?? 'sqlite';
}
