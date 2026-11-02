CREATE TABLE `senet_bar_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cash_move_id` integer NOT NULL,
	`item_text` text NOT NULL,
	`qty` integer NOT NULL,
	`price` integer NOT NULL,
	`amount` integer NOT NULL,
	`mismatch` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`cash_move_id`) REFERENCES `senet_cash_moves`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_bar_purchases_move_idx` ON `senet_bar_purchases` (`cash_move_id`);--> statement-breakpoint
CREATE TABLE `senet_cash_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shift_id` integer NOT NULL,
	`senet_ref` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`at` text NOT NULL,
	`cashier` text DEFAULT '' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`rule_id` integer,
	`operation_id` integer,
	`prev_operation_id` integer,
	`no_repost` integer DEFAULT false NOT NULL,
	`missing_in_senet` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `senet_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `senet_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prev_operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senet_cash_moves_ref_uq` ON `senet_cash_moves` (`shift_id`,`senet_ref`);--> statement-breakpoint
CREATE INDEX `senet_cash_moves_op_idx` ON `senet_cash_moves` (`operation_id`);--> statement-breakpoint
CREATE INDEX `senet_cash_moves_prev_op_idx` ON `senet_cash_moves` (`prev_operation_id`);--> statement-breakpoint
CREATE TABLE `senet_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`at` text NOT NULL,
	`code` text NOT NULL,
	`amount` integer NOT NULL,
	`used` integer DEFAULT false NOT NULL,
	`workstation` integer,
	`guest_login` text DEFAULT '' NOT NULL,
	`phone_hash` text,
	`phone_mask` text,
	`cashier` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_checks_office_at_idx` ON `senet_checks` (`office_id`,`at`);--> statement-breakpoint
CREATE TABLE `senet_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`name` text NOT NULL,
	`org` text NOT NULL,
	`source` text DEFAULT 'admin_token' NOT NULL,
	`auth_method` text NOT NULL,
	`credentials_secret` text NOT NULL,
	`credentials_hint` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`last_sync_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`created_by` integer NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_connections_company_idx` ON `senet_connections` (`company_id`);--> statement-breakpoint
CREATE TABLE `senet_offices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`senet_office_id` integer NOT NULL,
	`cash_desk_id` integer DEFAULT 1 NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`project_id` integer,
	`cash_account_id` integer,
	`kaspi_account_id` integer,
	`income_category_id` integer,
	`history_from` text,
	`cash_offset` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `senet_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kaspi_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`income_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senet_offices_key_uq` ON `senet_offices` (`connection_id`,`senet_office_id`,`cash_desk_id`);--> statement-breakpoint
CREATE TABLE `senet_postings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shift_id` integer NOT NULL,
	`kind` text NOT NULL,
	`operation_id` integer,
	`prev_operation_id` integer,
	`amount` integer NOT NULL,
	`no_repost` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `senet_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prev_operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senet_postings_kind_uq` ON `senet_postings` (`shift_id`,`kind`);--> statement-breakpoint
CREATE INDEX `senet_postings_op_idx` ON `senet_postings` (`operation_id`);--> statement-breakpoint
CREATE INDEX `senet_postings_prev_op_idx` ON `senet_postings` (`prev_operation_id`);--> statement-breakpoint
CREATE TABLE `senet_raw` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`report` text NOT NULL,
	`office_id` integer,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`fetched_at` text NOT NULL,
	`status` integer NOT NULL,
	`file_key` text NOT NULL,
	`sha256` text NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `senet_connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senet_raw_sha_uq` ON `senet_raw` (`connection_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `senet_raw_fetched_idx` ON `senet_raw` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `senet_refills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`at` text NOT NULL,
	`guest_login` text DEFAULT '' NOT NULL,
	`account_type` text DEFAULT '' NOT NULL,
	`amount` integer NOT NULL,
	`workstation` integer,
	`phone_hash` text,
	`phone_mask` text,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_refills_office_at_idx` ON `senet_refills` (`office_id`,`at`);--> statement-breakpoint
CREATE TABLE `senet_review_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shift_id` integer NOT NULL,
	`cash_move_id` integer,
	`reason` text NOT NULL,
	`suggestions` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`open_key` text,
	`answer` text,
	`operation_id` integer,
	`answered_by` integer,
	`answered_via` text,
	`answered_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `senet_shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cash_move_id`) REFERENCES `senet_cash_moves`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`answered_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senet_review_items_open_uq` ON `senet_review_items` (`open_key`);--> statement-breakpoint
CREATE INDEX `senet_review_items_shift_idx` ON `senet_review_items` (`shift_id`);--> statement-breakpoint
CREATE TABLE `senet_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`office_id` integer,
	`type` text NOT NULL,
	`pattern` text DEFAULT '' NOT NULL,
	`match` text DEFAULT 'word' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`category_id` integer,
	`counterparty_id` integer,
	`comment_template` text,
	`flags` text DEFAULT '{}' NOT NULL,
	`created_from_review` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` integer NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_rules_company_idx` ON `senet_rules` (`company_id`);--> statement-breakpoint
CREATE TABLE `senet_shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`opened_at` text NOT NULL,
	`closed_at` text,
	`opened_by` text DEFAULT '' NOT NULL,
	`closed_by` text,
	`end_balance` integer NOT NULL,
	`cashless` integer DEFAULT 0 NOT NULL,
	`cash_in` integer DEFAULT 0 NOT NULL,
	`cash_out` integer DEFAULT 0 NOT NULL,
	`revenue` integer DEFAULT 0 NOT NULL,
	`revenue_tx` integer,
	`posted_revenue` integer,
	`changed_after_post` integer DEFAULT false NOT NULL,
	`post_error` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senet_shifts_key_uq` ON `senet_shifts` (`office_id`,`opened_at`);--> statement-breakpoint
CREATE TABLE `senet_sold_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`shift_id` integer,
	`at` text NOT NULL,
	`item` text NOT NULL,
	`qty` integer,
	`amount` integer NOT NULL,
	`payment` text DEFAULT '' NOT NULL,
	`refund` integer DEFAULT false NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `senet_shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_sold_items_office_at_idx` ON `senet_sold_items` (`office_id`,`at`);--> statement-breakpoint
CREATE TABLE `senet_sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`trigger` text NOT NULL,
	`result` text,
	`error` text,
	`counts` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `senet_connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_sync_runs_connection_idx` ON `senet_sync_runs` (`connection_id`);--> statement-breakpoint
CREATE TABLE `senet_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`at` text NOT NULL,
	`code` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`payment` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_transactions_office_at_idx` ON `senet_transactions` (`office_id`,`at`);