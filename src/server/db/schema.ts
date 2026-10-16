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
