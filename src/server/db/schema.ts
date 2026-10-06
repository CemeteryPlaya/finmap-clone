import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
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
