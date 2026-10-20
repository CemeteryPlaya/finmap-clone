import { toPgTables } from './pg-schema';
import * as sqlite from './schema-sqlite';

/** Схема Postgres — из схемы SQLite (Р3–Р5 плана 2026-10-20-vercel-postgres); файл читает drizzle-kit (drizzle.pg.config.ts). */
const t = toPgTables({
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
});

export const users = t.users;
export const sessions = t.sessions;
export const auditLog = t.auditLog;
export const auditUndo = t.auditUndo;
export const currencies = t.currencies;
export const companies = t.companies;
export const projects = t.projects;
export const accounts = t.accounts;
export const categories = t.categories;
export const counterparties = t.counterparties;
export const tags = t.tags;
export const splitPresets = t.splitPresets;
export const userPreferences = t.userPreferences;
export const exchangeRates = t.exchangeRates;
export const fixedRates = t.fixedRates;
export const imports = t.imports;
export const operations = t.operations;
export const operationLines = t.operationLines;
export const operationTags = t.operationTags;
export const attachments = t.attachments;
export const savedFilters = t.savedFilters;
export const stockItemGroups = t.stockItemGroups;
export const stockItems = t.stockItems;
export const stockItemPrices = t.stockItemPrices;
export const stockComboParts = t.stockComboParts;
export const stockWarehouses = t.stockWarehouses;
export const stockDocs = t.stockDocs;
export const stockDocLines = t.stockDocLines;
export const stockBatches = t.stockBatches;
export const stockAllocations = t.stockAllocations;
export const stockDocPayments = t.stockDocPayments;
export const stockDocPostings = t.stockDocPostings;
export const analyticsIndicatorParts = t.analyticsIndicatorParts;
