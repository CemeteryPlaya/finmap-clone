import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { COUNTERPARTY_TYPES } from '../../shared/counterparties';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  login: text('login').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  disabledAt: text('disabled_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    remember: integer('remember', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id'),
    userId: integer('user_id'),
    entity: text('entity').notNull(),
    entityId: integer('entity_id'),
    action: text('action').notNull(),
    diff: text('diff'),
    at: text('at').notNull(),
  },
  (t) => [index('audit_company_idx').on(t.companyId, t.id)],
);

export const currencies = sqliteTable('currencies', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  symbol: text('symbol').notNull(),
  minorUnits: integer('minor_units').notNull(),
});

export const companies = sqliteTable('companies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  baseCurrency: text('base_currency')
    .notNull()
    .references(() => currencies.code),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});

export const projects = sqliteTable(
  'projects',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    templateKey: text('template_key').notNull(),
    templateParams: text('template_params').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('projects_company_idx').on(t.companyId, t.orderIndex)],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: integer('project_id').references(() => projects.id),
    name: text('name').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    startingBalance: integer('starting_balance').notNull(),
    openedAt: text('opened_at').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('accounts_company_idx').on(t.companyId, t.orderIndex)],
);

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    parentId: integer('parent_id').references((): AnySQLiteColumn => categories.id),
    name: text('name').notNull(),
    systemKey: text('system_key'),
    templateRef: text('template_ref'),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [
    uniqueIndex('categories_template_ref_uq').on(t.companyId, t.kind, t.templateRef),
    uniqueIndex('categories_system_key_uq').on(t.companyId, t.kind, t.systemKey),
    index('categories_company_idx').on(t.companyId, t.kind, t.parentId),
  ],
);

export const counterparties = sqliteTable(
  'counterparties',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    type: text('type', { enum: COUNTERPARTY_TYPES }).notNull(),
    name: text('name').notNull(),
    comment: text('comment'),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('counterparties_company_idx').on(t.companyId, t.orderIndex)],
);

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    /** foldCase(cleanName(name)): уникальность без учёта регистра, «ё» и невидимых символов. */
    nameKey: text('name_key').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [uniqueIndex('tags_name_key_uq').on(t.companyId, t.nameKey), index('tags_company_idx').on(t.companyId, t.orderIndex)],
);

export const splitPresets = sqliteTable(
  'split_presets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    /** JSON `[{categoryId, projectId, bp}]`; ссылки без внешних ключей (инвариант 10). */
    lines: text('lines').notNull(),
    orderIndex: integer('order_index').notNull(),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [index('split_presets_company_idx').on(t.companyId, t.orderIndex)],
);

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    /** JSON-значение. */
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('user_preferences_uq').on(t.userId, t.key)],
);

export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Календарная дата `YYYY-MM-DD`. */
    date: text('date').notNull(),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    /** Курс за 1 единицу валюты в тенге, десятичная строка. */
    rateToKzt: text('rate_to_kzt').notNull(),
    source: text('source', { enum: ['nbrk', 'manual'] }).notNull(),
    createdBy: integer('created_by').references(() => users.id),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [uniqueIndex('exchange_rates_uq').on(t.date, t.currency), index('exchange_rates_currency_idx').on(t.currency, t.date)],
);

export const fixedRates = sqliteTable(
  'fixed_rates',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    currency: text('currency')
      .notNull()
      .references(() => currencies.code),
    /** Курс за 1 единицу валюты в базовой валюте компании. */
    rate: text('rate').notNull(),
    validFrom: text('valid_from').notNull(),
    /** null — бессрочно. */
    validTo: text('valid_to'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('fixed_rates_company_idx').on(t.companyId, t.currency, t.validFrom)],
);

export const operations = sqliteTable(
  'operations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    type: text('type', { enum: ['income', 'expense', 'transfer'] }).notNull(),
    /** На этапе 1 только 'actual'; 'planned' — для этапа 3. */
    status: text('status', { enum: ['actual', 'planned'] }).notNull(),
    paidAt: text('paid_at').notNull(),
    accrualDate: text('accrual_date'),
    accountId: integer('account_id')
      .notNull()
      .references(() => accounts.id),
    amount: integer('amount').notNull(),
    toAccountId: integer('to_account_id').references(() => accounts.id),
    toAmount: integer('to_amount'),
    /** Курс к базовой валюте для показа (10 значащих цифр). */
    rate: text('rate').notNull(),
    baseAmount: integer('base_amount').notNull(),
    counterpartyId: integer('counterparty_id').references(() => counterparties.id),
    comment: text('comment'),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('operations_company_paid_idx').on(t.companyId, t.paidAt, t.id),
    index('operations_account_idx').on(t.accountId),
    index('operations_to_account_idx').on(t.toAccountId),
    index('operations_counterparty_idx').on(t.counterpartyId),
  ],
);

export const operationLines = sqliteTable(
  'operation_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    categoryId: integer('category_id').references(() => categories.id),
    projectId: integer('project_id').references(() => projects.id),
    amount: integer('amount').notNull(),
    baseAmount: integer('base_amount').notNull(),
  },
  (t) => [
    index('operation_lines_op_idx').on(t.operationId, t.position),
    index('operation_lines_category_idx').on(t.categoryId),
    index('operation_lines_project_idx').on(t.projectId),
  ],
);

export const operationTags = sqliteTable(
  'operation_tags',
  {
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.operationId, t.tagId] }), index('operation_tags_tag_idx').on(t.tagId)],
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id),
    originalName: text('original_name').notNull(),
    /** Имя файла в data/uploads: случайный UUID и расширение распознанного типа. */
    storedName: text('stored_name').notNull(),
    /** Тип, распознанный по содержимому (§8). */
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    createdAt: text('created_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('attachments_operation_idx').on(t.operationId), uniqueIndex('attachments_stored_uq').on(t.storedName)],
);
