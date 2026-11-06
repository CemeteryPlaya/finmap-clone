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
  analyticsSettings: sqlite.analyticsSettings,
  senetConnections: sqlite.senetConnections,
  senetOffices: sqlite.senetOffices,
  senetShifts: sqlite.senetShifts,
  senetRules: sqlite.senetRules,
  senetCashMoves: sqlite.senetCashMoves,
  senetPostings: sqlite.senetPostings,
  senetReviewItems: sqlite.senetReviewItems,
  senetSyncRuns: sqlite.senetSyncRuns,
  senetRaw: sqlite.senetRaw,
  senetTransactions: sqlite.senetTransactions,
  senetSoldItems: sqlite.senetSoldItems,
  senetBarPurchases: sqlite.senetBarPurchases,
  senetChecks: sqlite.senetChecks,
  senetRefills: sqlite.senetRefills,
  senetStock: sqlite.senetStock,
  senetGoodsMoves: sqlite.senetGoodsMoves,
  senetLoad: sqlite.senetLoad,
  senetDataSpans: sqlite.senetDataSpans,
  senetTickets: sqlite.senetTickets,
  senetZones: sqlite.senetZones,
  senetGuestLinks: sqlite.senetGuestLinks,
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
export const analyticsSettings = t.analyticsSettings;
export const senetConnections = t.senetConnections;
export const senetOffices = t.senetOffices;
export const senetShifts = t.senetShifts;
export const senetRules = t.senetRules;
export const senetCashMoves = t.senetCashMoves;
export const senetPostings = t.senetPostings;
export const senetReviewItems = t.senetReviewItems;
export const senetSyncRuns = t.senetSyncRuns;
export const senetRaw = t.senetRaw;
export const senetTransactions = t.senetTransactions;
export const senetSoldItems = t.senetSoldItems;
export const senetBarPurchases = t.senetBarPurchases;
export const senetChecks = t.senetChecks;
export const senetRefills = t.senetRefills;
export const senetStock = t.senetStock;
export const senetGoodsMoves = t.senetGoodsMoves;
export const senetLoad = t.senetLoad;
export const senetDataSpans = t.senetDataSpans;
export const senetTickets = t.senetTickets;
export const senetZones = t.senetZones;
export const senetGuestLinks = t.senetGuestLinks;
