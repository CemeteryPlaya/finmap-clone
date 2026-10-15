CREATE TABLE `stock_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`line_id` integer NOT NULL,
	`batch_id` integer,
	`qty` integer NOT NULL,
	`cost` integer,
	`component_item_id` integer,
	FOREIGN KEY (`line_id`) REFERENCES `stock_doc_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `stock_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`component_item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_allocations_line_idx` ON `stock_allocations` (`line_id`);--> statement-breakpoint
CREATE INDEX `stock_allocations_batch_idx` ON `stock_allocations` (`batch_id`);--> statement-breakpoint
CREATE TABLE `stock_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`warehouse_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`origin_line_id` integer NOT NULL,
	`source_batch_id` integer,
	`at` text NOT NULL,
	`qty_in` integer NOT NULL,
	`cost_in` integer NOT NULL,
	`qty_left` integer NOT NULL,
	`cost_left` integer NOT NULL,
	FOREIGN KEY (`warehouse_id`) REFERENCES `stock_warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_line_id`) REFERENCES `stock_doc_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_batch_id`) REFERENCES `stock_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_batches_pair_idx` ON `stock_batches` (`warehouse_id`,`item_id`,`at`);--> statement-breakpoint
CREATE INDEX `stock_batches_origin_idx` ON `stock_batches` (`origin_line_id`);--> statement-breakpoint
CREATE TABLE `stock_combo_parts` (
	`combo_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`qty` integer NOT NULL,
	PRIMARY KEY(`combo_id`, `item_id`),
	FOREIGN KEY (`combo_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_doc_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_id` integer NOT NULL,
	`position` integer NOT NULL,
	`item_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`amount` integer,
	`counted_qty` integer,
	`expected_qty` integer,
	FOREIGN KEY (`doc_id`) REFERENCES `stock_docs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_doc_lines_doc_idx` ON `stock_doc_lines` (`doc_id`,`position`);--> statement-breakpoint
CREATE INDEX `stock_doc_lines_item_idx` ON `stock_doc_lines` (`item_id`);--> statement-breakpoint
CREATE TABLE `stock_doc_payments` (
	`doc_id` integer NOT NULL,
	`operation_id` integer NOT NULL,
	`amount` integer NOT NULL,
	PRIMARY KEY(`doc_id`, `operation_id`),
	FOREIGN KEY (`doc_id`) REFERENCES `stock_docs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stock_doc_payments_op_idx` ON `stock_doc_payments` (`operation_id`);--> statement-breakpoint
CREATE TABLE `stock_doc_postings` (
	`doc_id` integer PRIMARY KEY NOT NULL,
	`operation_id` integer NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `stock_docs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `stock_doc_postings_op_idx` ON `stock_doc_postings` (`operation_id`);--> statement-breakpoint
CREATE TABLE `stock_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`type` text NOT NULL,
	`number` text NOT NULL,
	`at` text NOT NULL,
	`warehouse_id` integer NOT NULL,
	`to_warehouse_id` integer,
	`counterparty_id` integer,
	`reason` text,
	`status` text DEFAULT 'posted' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`comment` text,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`warehouse_id`) REFERENCES `stock_warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_warehouse_id`) REFERENCES `stock_warehouses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_docs_number_uq` ON `stock_docs` (`company_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_docs_source_uq` ON `stock_docs` (`source`,`source_ref`);--> statement-breakpoint
CREATE INDEX `stock_docs_warehouse_idx` ON `stock_docs` (`warehouse_id`,`at`);--> statement-breakpoint
CREATE INDEX `stock_docs_company_idx` ON `stock_docs` (`company_id`,`type`,`at`);--> statement-breakpoint
CREATE INDEX `stock_docs_counterparty_idx` ON `stock_docs` (`counterparty_id`);--> statement-breakpoint
CREATE TABLE `stock_item_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`order_index` integer NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_item_groups_name_key_uq` ON `stock_item_groups` (`company_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `stock_item_prices` (
	`item_id` integer NOT NULL,
	`price` integer NOT NULL,
	`valid_from` text NOT NULL,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`item_id`, `valid_from`),
	FOREIGN KEY (`item_id`) REFERENCES `stock_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`group_id` integer,
	`unit` text NOT NULL,
	`barcode` text,
	`is_combo` integer DEFAULT false NOT NULL,
	`sale_price` integer DEFAULT 0 NOT NULL,
	`min_qty` integer,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `stock_item_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_items_name_key_uq` ON `stock_items` (`company_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `stock_items_group_idx` ON `stock_items` (`group_id`);--> statement-breakpoint
CREATE TABLE `stock_warehouses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`project_id` integer NOT NULL,
	`name` text NOT NULL,
	`receipts_source` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_warehouses_project_uq` ON `stock_warehouses` (`project_id`);--> statement-breakpoint
CREATE INDEX `stock_warehouses_company_idx` ON `stock_warehouses` (`company_id`);