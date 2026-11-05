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
  (t) => [
    index('audit_company_idx').on(t.companyId, t.id),
    // действия одной операции: каскад отмены и «нельзя раньше удаления» (план 2026-10-20, задача 2)
    index('audit_entity_idx').on(t.companyId, t.entity, t.entityId),
  ],
);

/** Отметка «отменено» (спецификация 2026-10-19, часть 2): запись истории → запись «Отмена», которая её отменила. */
export const auditUndo = sqliteTable('audit_undo', {
  auditId: integer('audit_id')
    .primaryKey()
    .references(() => auditLog.id),
  undoId: integer('undo_id')
    .notNull()
    .references(() => auditLog.id),
});

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

/** Импорт файла (§6.1 спецификации импорта): одна запись на импорт; ссылки в JSON — без внешних ключей (инвариант 10). */
export const imports = sqliteTable(
  'imports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    /** Кто импортировал. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** Имя файла (cleanName, до 200 символов). */
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    /** SHA-256 файла: «этот файл уже импортирован» (W8). */
    fileSha256: text('file_sha256').notNull(),
    status: text('status', { enum: ['done', 'undone'] }).notNull(),
    /** JSON `{ rows, income, expense, transfer, added, duplicates, skippedFuture }`. */
    counts: text('counts').notNull(),
    /** JSON id созданного: `{ accounts, categories, counterparties, projects, tags }`. */
    created: text('created').notNull(),
    /** JSON `[{ accountId, before: { startingBalance, openedAt }, after }]` — существующие счета, изменённые импортом. */
    accountChanges: text('account_changes').notNull(),
    /** JSON итога отмены (§7.3). */
    undoResult: text('undo_result'),
    createdAt: text('created_at').notNull(),
    undoneAt: text('undone_at'),
    undoneBy: integer('undone_by').references(() => users.id),
  },
  (t) => [index('imports_company_idx').on(t.companyId, t.id)],
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
    /** Импорт, которым создана операция (§6.1 спецификации импорта); обычные операции — null. */
    importId: integer('import_id').references(() => imports.id),
  },
  (t) => [
    index('operations_company_paid_idx').on(t.companyId, t.paidAt, t.id),
    /** «Прибыль», «Проекты», «Показатели» выбирают строки по дате сделки (§3.2 спецификации «Аналитика», bench:reports). */
    index('operations_company_accrual_idx').on(t.companyId, t.accrualDate),
    index('operations_import_idx').on(t.importId),
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

export const savedFilters = sqliteTable(
  'saved_filters',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Владелец: фильтр видит и меняет только он (§6). */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    /** JSON фильтра журнала (journalFilterSchema); ссылки на справочники без внешних ключей (инвариант 10). */
    filter: text('filter').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('saved_filters_owner_idx').on(t.userId, t.companyId)],
);

/* ---------- «Склад» (спецификация «Склад», §3) ---------- */

/** Группа товаров: «Напитки», «Еда». */
export const stockItemGroups = sqliteTable(
  'stock_item_groups',
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
  (t) => [uniqueIndex('stock_item_groups_name_key_uq').on(t.companyId, t.nameKey)],
);

/** Товар каталога компании. Количества — тысячные доли единицы, деньги — минимальные единицы базовой валюты. */
export const stockItems = sqliteTable(
  'stock_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    groupId: integer('group_id').references(() => stockItemGroups.id),
    unit: text('unit', { enum: ['pcs', 'l', 'kg', 'pack'] }).notNull(),
    barcode: text('barcode'),
    isCombo: integer('is_combo', { mode: 'boolean' }).notNull().default(false),
    /** Текущая цена продажи за единицу: цена из stock_item_prices на сегодня. */
    salePrice: integer('sale_price').notNull().default(0),
    /** Минимальный остаток для предупреждения «Мало». */
    minQty: integer('min_qty'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [uniqueIndex('stock_items_name_key_uq').on(t.companyId, t.nameKey), index('stock_items_group_idx').on(t.groupId)],
);

/** История цены продажи: цена на момент t — последняя строка с valid_from ≤ t. */
export const stockItemPrices = sqliteTable(
  'stock_item_prices',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => stockItems.id),
    price: integer('price').notNull(),
    /** Календарная дата `YYYY-MM-DD`. */
    validFrom: text('valid_from').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.validFrom] })],
);

/** Состав комплекта (план «Склад-2»). */
export const stockComboParts = sqliteTable(
  'stock_combo_parts',
  {
    comboId: integer('combo_id')
      .notNull()
      .references(() => stockItems.id),
    itemId: integer('item_id')
      .notNull()
      .references(() => stockItems.id),
    qty: integer('qty').notNull(),
    /** Порядок ввода состава (раньше — rowid SQLite; в Postgres его нет). */
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.comboId, t.itemId] })],
);

/** Склад проекта: у проекта не больше одного. */
export const stockWarehouses = sqliteTable(
  'stock_warehouses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    /** Откуда поступления (план «Склад-Senet»). */
    receiptsSource: text('receipts_source', { enum: ['manual', 'senet'] }).notNull().default('manual'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [uniqueIndex('stock_warehouses_project_uq').on(t.projectId), index('stock_warehouses_company_idx').on(t.companyId)],
);

/** Документ склада. Остатки меняются только документами; проведённые документы пересчитывают партии (§5.2). */
export const stockDocs = sqliteTable(
  'stock_docs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    type: text('type', { enum: ['receipt', 'sale', 'writeoff', 'transfer', 'count'] }).notNull(),
    /** «П-0001», «Р-0001», «С-0001»: по типу в компании. */
    number: text('number').notNull(),
    /** Момент документа, ISO UTC фиксированной ширины. */
    at: text('at').notNull(),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => stockWarehouses.id),
    toWarehouseId: integer('to_warehouse_id').references(() => stockWarehouses.id),
    /** Поставщик у поступления, покупатель у продажи. */
    counterpartyId: integer('counterparty_id').references(() => counterparties.id),
    reason: text('reason', { enum: ['defect', 'spoiled', 'own_use', 'other'] }),
    status: text('status', { enum: ['draft', 'posted'] }).notNull().default('posted'),
    source: text('source', { enum: ['manual', 'senet', 'import'] }).notNull().default('manual'),
    sourceRef: text('source_ref'),
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
    uniqueIndex('stock_docs_number_uq').on(t.companyId, t.number),
    uniqueIndex('stock_docs_source_uq').on(t.companyId, t.source, t.sourceRef),
    index('stock_docs_warehouse_idx').on(t.warehouseId, t.at),
    index('stock_docs_company_idx').on(t.companyId, t.type, t.at),
    index('stock_docs_counterparty_idx').on(t.counterpartyId),
  ],
);

export const stockDocLines = sqliteTable(
  'stock_doc_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    docId: integer('doc_id')
      .notNull()
      .references(() => stockDocs.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    itemId: integer('item_id')
      .notNull()
      .references(() => stockItems.id),
    qty: integer('qty').notNull(),
    /** У поступления сумма закупки по строке, у продажи сумма продажи; у списания пусто. */
    amount: integer('amount'),
    countedQty: integer('counted_qty'),
    expectedQty: integer('expected_qty'),
  },
  (t) => [index('stock_doc_lines_doc_idx').on(t.docId, t.position), index('stock_doc_lines_item_idx').on(t.itemId)],
);

/** Партия: приход товара на склад одной строкой документа. Производные данные: пересобираются по документам. */
export const stockBatches = sqliteTable(
  'stock_batches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    warehouseId: integer('warehouse_id')
      .notNull()
      .references(() => stockWarehouses.id),
    itemId: integer('item_id')
      .notNull()
      .references(() => stockItems.id),
    originLineId: integer('origin_line_id')
      .notNull()
      .references(() => stockDocLines.id),
    sourceBatchId: integer('source_batch_id').references((): AnySQLiteColumn => stockBatches.id),
    at: text('at').notNull(),
    qtyIn: integer('qty_in').notNull(),
    costIn: integer('cost_in').notNull(),
    qtyLeft: integer('qty_left').notNull(),
    costLeft: integer('cost_left').notNull(),
  },
  (t) => [index('stock_batches_pair_idx').on(t.warehouseId, t.itemId, t.at), index('stock_batches_origin_idx').on(t.originLineId), index('stock_batches_source_idx').on(t.sourceBatchId)],
);

/** Откуда списана строка продажи или списания; пустая партия — не хватило остатка (§5.3). */
export const stockAllocations = sqliteTable(
  'stock_allocations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    lineId: integer('line_id')
      .notNull()
      .references(() => stockDocLines.id, { onDelete: 'cascade' }),
    batchId: integer('batch_id').references(() => stockBatches.id),
    qty: integer('qty').notNull(),
    cost: integer('cost'),
    componentItemId: integer('component_item_id').references(() => stockItems.id),
  },
  (t) => [index('stock_allocations_line_idx').on(t.lineId), index('stock_allocations_batch_idx').on(t.batchId)],
);

/** Оплата закупки: расход журнала погашает поступление. Сумма оплат документа может превышать сумму документа (переплата). */
export const stockDocPayments = sqliteTable(
  'stock_doc_payments',
  {
    docId: integer('doc_id')
      .notNull()
      .references(() => stockDocs.id),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.docId, t.operationId] }), index('stock_doc_payments_op_idx').on(t.operationId)],
);

/** Продажа, проведённая доходом в журнал. */
export const stockDocPostings = sqliteTable(
  'stock_doc_postings',
  {
    docId: integer('doc_id')
      .primaryKey()
      .references(() => stockDocs.id),
    operationId: integer('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
  },
  (t) => [index('stock_doc_postings_op_idx').on(t.operationId)],
);

/* ---------- «Аналитика» (спецификация «Аналитика», §8.2) ---------- */

/**
 * Настройка части «Финансовых показателей»: какие категории входят в часть и учитывается ли склад. Пока строки нет,
 * действует умолчание (§8.2). category_ids — JSON-массив id категорий без внешних ключей: удалённая категория просто
 * ничего не находит; all_categories — «Все категории», отдельный выбор, а не список.
 */
export const analyticsIndicatorParts = sqliteTable(
  'analytics_indicator_parts',
  {
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    part: text('part', { enum: ['revenue', 'cogs', 'variable', 'operating'] }).notNull(),
    allCategories: integer('all_categories', { mode: 'boolean' }).notNull(),
    categoryIds: text('category_ids').notNull(),
    includeStock: integer('include_stock', { mode: 'boolean' }).notNull(),
    updatedAt: text('updated_at').notNull(),
    updatedBy: integer('updated_by').references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.part] })],
);

/**
 * «Настройки → Аналитика» (спецификация «Аналитика клуба», §10.3): общие для компании. Ключи — `dashboards` и
 * `tiles.<шаблон>`, значение — JSON; нет записи — умолчания каталога.
 */
export const analyticsSettings = sqliteTable(
  'analytics_settings',
  {
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: text('updated_at').notNull(),
    updatedBy: integer('updated_by').references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })],
);

/* ---------- Senet (спецификация 2026-11-02-senet-autopost, §9) ---------- */

/** Подключение к организации Senet; данные входа — только зашифрованными (`*_secret` отсекает история). */
export const senetConnections = sqliteTable(
  'senet_connections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    name: text('name').notNull(),
    org: text('org').notNull(),
    source: text('source', { enum: ['admin_token', 'app_key'] })
      .notNull()
      .default('admin_token'),
    authMethod: text('auth_method', { enum: ['password', 'token', 'app_key'] }).notNull(),
    credentialsSecret: text('credentials_secret').notNull(),
    credentialsHint: text('credentials_hint').notNull(),
    status: text('status', { enum: ['ok', 'key_rejected', 'unreachable'] })
      .notNull()
      .default('ok'),
    lastSyncAt: text('last_sync_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    archivedAt: text('archived_at'),
  },
  (t) => [index('senet_connections_company_idx').on(t.companyId)],
);

/** Клуб (офис и касса Senet) и его связи с учётом. Проект уникален среди включённых — проверяет сервис. */
export const senetOffices = sqliteTable(
  'senet_offices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => senetConnections.id),
    senetOfficeId: integer('senet_office_id').notNull(),
    cashDeskId: integer('cash_desk_id').notNull().default(1),
    name: text('name').notNull().default(''),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
    projectId: integer('project_id').references(() => projects.id),
    cashAccountId: integer('cash_account_id').references(() => accounts.id),
    kaspiAccountId: integer('kaspi_account_id').references(() => accounts.id),
    incomeCategoryId: integer('income_category_id').references(() => categories.id),
    /** «Загружать с даты»: смены, открытые раньше, не проводятся (§5.5). */
    historyFrom: text('history_from'),
    /** Постоянная разница кассы «учёт − Senet», тиыны (§8.1). */
    cashOffset: integer('cash_offset').notNull().default(0),
  },
  (t) => [uniqueIndex('senet_offices_key_uq').on(t.connectionId, t.senetOfficeId, t.cashDeskId)],
);

/** Кассовая смена Senet. Номера сессии в отчёте нет — ключ: клуб и начало (§5.2). */
export const senetShifts = sqliteTable(
  'senet_shifts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at'),
    openedBy: text('opened_by').notNull().default(''),
    closedBy: text('closed_by'),
    /** «Сумма» Senet — остаток в кассе на закрытии, не выручка. */
    endBalance: integer('end_balance').notNull(),
    cashless: integer('cashless').notNull().default(0),
    cashIn: integer('cash_in').notNull().default(0),
    cashOut: integer('cash_out').notNull().default(0),
    revenue: integer('revenue').notNull().default(0),
    /** Σ транзакций Senet за смену — контроль выручки; null — не забирали. */
    revenueTx: integer('revenue_tx'),
    /** Выручка на момент проведения доходов: другая выручка — «Senet изменил смену после проведения». */
    postedRevenue: integer('posted_revenue'),
    changedAfterPost: integer('changed_after_post', { mode: 'boolean' }).notNull().default(false),
    postError: text('post_error'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('senet_shifts_key_uq').on(t.officeId, t.openedAt)],
);

/** Правило разноски (§4.3): код знает только типы, слова и ссылки — данные компании. */
export const senetRules = sqliteTable(
  'senet_rules',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id),
    /** Только для клуба; null — для всех клубов компании. */
    officeId: integer('office_id').references(() => senetOffices.id),
    type: text('type', {
      enum: [
        'exact',
        'kaspi',
        'trainee',
        'salary_word',
        'extra_pay_word',
        'employee_alias',
        'master',
        'owner_word',
        'owner_a_alias',
        'lunch',
        'keyword',
        'bar_item',
        'bar_supplier',
      ],
    }).notNull(),
    /** Нормализованное слово или фраза; пусто — настроечная строка типа (категория, контрагент по умолчанию). */
    pattern: text('pattern').notNull().default(''),
    match: text('match', { enum: ['word', 'first', 'phrase', 'prefix', 'contains'] })
      .notNull()
      .default('word'),
    priority: integer('priority').notNull().default(0),
    categoryId: integer('category_id').references(() => categories.id),
    counterpartyId: integer('counterparty_id').references(() => counterparties.id),
    /** Комментарий операции: текст или `{orig}` — исходный текст выемки. */
    commentTemplate: text('comment_template'),
    /** JSON: { mistaken?: ошибочный алиас, defect?: брак }. */
    flags: text('flags').notNull().default('{}'),
    createdFromReview: integer('created_from_review', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id),
    archivedAt: text('archived_at'),
  },
  (t) => [index('senet_rules_company_idx').on(t.companyId)],
);

/** Внесение или выемка смены; operation_id — что проведено (§5.2), prev_operation_id — удалённая предшественница (П3). */
export const senetCashMoves = sqliteTable(
  'senet_cash_moves',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    shiftId: integer('shift_id')
      .notNull()
      .references(() => senetShifts.id),
    /** `{at с мс}|{amount}|{нормализованный комментарий}|{n}` (П6). */
    senetRef: text('senet_ref').notNull(),
    kind: text('kind', { enum: ['in', 'out'] }).notNull(),
    amount: integer('amount').notNull(),
    at: text('at').notNull(),
    cashier: text('cashier').notNull().default(''),
    comment: text('comment').notNull().default(''),
    ruleId: integer('rule_id').references(() => senetRules.id),
    operationId: integer('operation_id').references(() => operations.id),
    prevOperationId: integer('prev_operation_id').references(() => operations.id),
    noRepost: integer('no_repost', { mode: 'boolean' }).notNull().default(false),
    missingInSenet: integer('missing_in_senet', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('senet_cash_moves_ref_uq').on(t.shiftId, t.senetRef),
    index('senet_cash_moves_op_idx').on(t.operationId),
    index('senet_cash_moves_prev_op_idx').on(t.prevOperationId),
  ],
);

/** Доход смены, проведённый в журнал: Каспи или Касса. */
export const senetPostings = sqliteTable(
  'senet_postings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    shiftId: integer('shift_id')
      .notNull()
      .references(() => senetShifts.id),
    kind: text('kind', { enum: ['kaspi', 'cash'] }).notNull(),
    operationId: integer('operation_id').references(() => operations.id),
    prevOperationId: integer('prev_operation_id').references(() => operations.id),
    amount: integer('amount').notNull(),
    noRepost: integer('no_repost', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('senet_postings_kind_uq').on(t.shiftId, t.kind),
    index('senet_postings_op_idx').on(t.operationId),
    index('senet_postings_prev_op_idx').on(t.prevOperationId),
  ],
);

/** Пункт очереди «Разобрать» (§6). open_key заполнен только у открытого пункта: один открытый пункт на выемку и причину. */
export const senetReviewItems = sqliteTable(
  'senet_review_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    shiftId: integer('shift_id')
      .notNull()
      .references(() => senetShifts.id),
    cashMoveId: integer('cash_move_id').references(() => senetCashMoves.id),
    reason: text('reason', { enum: ['unrecognized', 'name_only', 'salary_no_name', 'rule_broken', 'no_kaspi', 'negative_cash'] }).notNull(),
    suggestions: text('suggestions').notNull().default('[]'),
    status: text('status', { enum: ['open', 'answered', 'dismissed'] })
      .notNull()
      .default('open'),
    /** `{shift}|{move или 0}|{reason}` у открытого, null у закрытого. */
    openKey: text('open_key'),
    answer: text('answer'),
    operationId: integer('operation_id').references(() => operations.id),
    answeredBy: integer('answered_by').references(() => users.id),
    answeredVia: text('answered_via', { enum: ['web', 'telegram'] }),
    answeredAt: text('answered_at'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('senet_review_items_open_uq').on(t.openKey), index('senet_review_items_shift_idx').on(t.shiftId)],
);

/** Журнал забора (С15§4.3); хранятся последние 500 запусков на подключение. */
export const senetSyncRuns = sqliteTable(
  'senet_sync_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => senetConnections.id),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    trigger: text('trigger', { enum: ['hourly', 'cron', 'manual', 'period'] }).notNull(),
    /** null — запуск идёт. */
    result: text('result', { enum: ['ok', 'partial', 'failed'] }),
    error: text('error'),
    counts: text('counts').notNull().default('{}'),
  },
  (t) => [index('senet_sync_runs_connection_idx').on(t.connectionId)],
);

/** Описание сырого файла отчёта; сам xlsx — в FileStore по file_key, 90 дней (§9.2). */
export const senetRaw = sqliteTable(
  'senet_raw',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => senetConnections.id),
    report: text('report').notNull(),
    officeId: integer('office_id').references(() => senetOffices.id),
    fromDate: text('from_date').notNull(),
    toDate: text('to_date').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    status: integer('status').notNull(),
    fileKey: text('file_key').notNull(),
    sha256: text('sha256').notNull(),
  },
  (t) => [uniqueIndex('senet_raw_sha_uq').on(t.connectionId, t.sha256), index('senet_raw_fetched_idx').on(t.fetchedAt)],
);

/* Данные для склада и аналитики (§9.3): строки окна заменяются при повторном заборе, ссылок на них нет. */

export const senetTransactions = sqliteTable(
  'senet_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    at: text('at').notNull(),
    code: text('code').notNull(),
    kind: text('kind', { enum: ['sell', 'refund'] }).notNull(),
    amount: integer('amount').notNull(),
    payment: text('payment').notNull().default(''),
  },
  (t) => [index('senet_transactions_office_at_idx').on(t.officeId, t.at)],
);

export const senetSoldItems = sqliteTable(
  'senet_sold_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    shiftId: integer('shift_id').references(() => senetShifts.id),
    at: text('at').notNull(),
    item: text('item').notNull(),
    /** Количество × 1000, как у склада; у чеков времени — null. */
    qty: integer('qty'),
    amount: integer('amount').notNull(),
    payment: text('payment').notNull().default(''),
    refund: integer('refund', { mode: 'boolean' }).notNull().default(false),
    comment: text('comment').notNull().default(''),
  },
  (t) => [index('senet_sold_items_office_at_idx').on(t.officeId, t.at)],
);

/** Разобранная закупка бара из выемки: `товар × кол-во × цена` (§4.3, тип «Бар»). */
export const senetBarPurchases = sqliteTable(
  'senet_bar_purchases',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cashMoveId: integer('cash_move_id')
      .notNull()
      .references(() => senetCashMoves.id),
    itemText: text('item_text').notNull(),
    /** Количество × 1000. */
    qty: integer('qty').notNull(),
    price: integer('price').notNull(),
    amount: integer('amount').notNull(),
    /** Σ строк выемки не сходится с её суммой. */
    mismatch: integer('mismatch', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('senet_bar_purchases_move_idx').on(t.cashMoveId)],
);

/** Покупки времени; телефон — только HMAC и маска (§9.3). */
export const senetChecks = sqliteTable(
  'senet_checks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    at: text('at').notNull(),
    code: text('code').notNull(),
    amount: integer('amount').notNull(),
    used: integer('used', { mode: 'boolean' }).notNull().default(false),
    workstation: integer('workstation'),
    guestLogin: text('guest_login').notNull().default(''),
    phoneHash: text('phone_hash'),
    phoneMask: text('phone_mask'),
    cashier: text('cashier').notNull().default(''),
  },
  (t) => [index('senet_checks_office_at_idx').on(t.officeId, t.at)],
);

export const senetRefills = sqliteTable(
  'senet_refills',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    at: text('at').notNull(),
    guestLogin: text('guest_login').notNull().default(''),
    accountType: text('account_type').notNull().default(''),
    amount: integer('amount').notNull(),
    workstation: integer('workstation'),
    phoneHash: text('phone_hash'),
    phoneMask: text('phone_mask'),
  },
  (t) => [index('senet_refills_office_at_idx').on(t.officeId, t.at)],
);

/* Форматы — по пробному забору 2026-11-03 (задача 1): отчёты за окно без дат строк, загрузка — по сеансам. */

/** `shop_quantity`: товары бара за сутки — продано, пришло, списано, цены и остаток на конец окна. Количество × 1000. */
export const senetStock = sqliteTable(
  'senet_stock',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    fromAt: text('from_at').notNull(),
    toAt: text('to_at').notNull(),
    item: text('item').notNull(),
    soldQty: integer('sold_qty').notNull().default(0),
    restockQty: integer('restock_qty').notNull().default(0),
    writeOffQty: integer('write_off_qty').notNull().default(0),
    restockPrice: integer('restock_price'),
    restockSum: integer('restock_sum').notNull().default(0),
    sellingPrice: integer('selling_price'),
    soldSum: integer('sold_sum').notNull().default(0),
    actualQty: integer('actual_qty'),
  },
  (t) => [index('senet_stock_office_from_idx').on(t.officeId, t.fromAt)],
);

/** `movements_of_goods`: движение товаров за сутки по документам источника (поступление, продажа, списание). */
export const senetGoodsMoves = sqliteTable(
  'senet_goods_moves',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    fromAt: text('from_at').notNull(),
    toAt: text('to_at').notNull(),
    sourceOrder: text('source_order').notNull().default(''),
    cashier: text('cashier').notNull().default(''),
    category: text('category').notNull().default(''),
    item: text('item').notNull(),
    restockQty: integer('restock_qty').notNull().default(0),
    writeOffQty: integer('write_off_qty').notNull().default(0),
    restockPrice: integer('restock_price'),
    restockSum: integer('restock_sum').notNull().default(0),
    totalQty: integer('total_qty'),
    soldQty: integer('sold_qty').notNull().default(0),
    sellingPrice: integer('selling_price'),
    soldSum: integer('sold_sum').notNull().default(0),
    /** «Sold price sum in restock price» — себестоимость проданного по цене прихода. */
    soldCost: integer('sold_cost'),
    profit: integer('profit'),
    comment: text('comment').notNull().default(''),
  },
  (t) => [index('senet_goods_moves_office_from_idx').on(t.officeId, t.fromAt)],
);

/** `office_load_by_zones`: сеансы гостей по зонам и ПК; телефон — только HMAC и маска. */
export const senetLoad = sqliteTable(
  'senet_load',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    startAt: text('start_at').notNull(),
    endAt: text('end_at'),
    zone: text('zone').notNull().default(''),
    workstation: integer('workstation'),
    guestLogin: text('guest_login').notNull().default(''),
    phoneHash: text('phone_hash'),
    phoneMask: text('phone_mask'),
    age: integer('age'),
    tariff: text('tariff').notNull().default(''),
    debited: integer('debited').notNull().default(0),
    refilled: integer('refilled').notNull().default(0),
    durationSec: integer('duration_sec'),
  },
  (t) => [index('senet_load_office_start_idx').on(t.officeId, t.startAt)],
);

/**
 * `tickets` («Использование абонементов»): покупка пакета часов с баланса гостя (спецификация «Аналитика клуба», §16 R6).
 * Цена — тиыны, minutes — «Времени проведено»; телефон — только HMAC и маска.
 */
export const senetTickets = sqliteTable(
  'senet_tickets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    at: text('at').notNull(),
    guestLogin: text('guest_login').notNull().default(''),
    phoneHash: text('phone_hash'),
    phoneMask: text('phone_mask'),
    ticket: text('ticket').notNull(),
    price: integer('price').notNull(),
    minutes: integer('minutes'),
  },
  (t) => [index('senet_tickets_office_at_idx').on(t.officeId, t.at)],
);

/** Зоны клуба (спецификация «Аналитика клуба», §6.1): своё число ПК зоны; нет строки — места по данным Senet. */
export const senetZones = sqliteTable(
  'senet_zones',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    zone: text('zone').notNull(),
    seats: integer('seats').notNull(),
  },
  (t) => [uniqueIndex('senet_zones_office_zone_uq').on(t.officeId, t.zone)],
);

/**
 * Покрытие данных (спецификация «Аналитика клуба», §3.2, R1): отрезки `[from_at, to_at)`, за которые отчёт клуба принят и
 * записан. Пересекающиеся и смежные отрезки сливаются при записи.
 */
export const senetDataSpans = sqliteTable(
  'senet_data_spans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    officeId: integer('office_id')
      .notNull()
      .references(() => senetOffices.id),
    report: text('report').notNull(),
    fromAt: text('from_at').notNull(),
    toAt: text('to_at').notNull(),
  },
  (t) => [index('senet_data_spans_office_report_idx').on(t.officeId, t.report, t.fromAt)],
);
