CREATE TABLE `exchange_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`rate_to_kzt` text NOT NULL,
	`source` text NOT NULL,
	`created_by` integer,
	`fetched_at` text NOT NULL,
	FOREIGN KEY (`currency`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exchange_rates_uq` ON `exchange_rates` (`date`,`currency`);--> statement-breakpoint
CREATE INDEX `exchange_rates_currency_idx` ON `exchange_rates` (`currency`,`date`);--> statement-breakpoint
CREATE TABLE `fixed_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`currency` text NOT NULL,
	`rate` text NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`currency`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fixed_rates_company_idx` ON `fixed_rates` (`company_id`,`currency`,`valid_from`);--> statement-breakpoint
CREATE TABLE `operation_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_id` integer NOT NULL,
	`position` integer NOT NULL,
	`category_id` integer,
	`project_id` integer,
	`amount` integer NOT NULL,
	`base_amount` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `operation_lines_op_idx` ON `operation_lines` (`operation_id`,`position`);--> statement-breakpoint
CREATE INDEX `operation_lines_category_idx` ON `operation_lines` (`category_id`);--> statement-breakpoint
CREATE INDEX `operation_lines_project_idx` ON `operation_lines` (`project_id`);--> statement-breakpoint
CREATE TABLE `operation_tags` (
	`operation_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	PRIMARY KEY(`operation_id`, `tag_id`),
	FOREIGN KEY (`operation_id`) REFERENCES `operations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `operation_tags_tag_idx` ON `operation_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`paid_at` text NOT NULL,
	`accrual_date` text,
	`account_id` integer NOT NULL,
	`amount` integer NOT NULL,
	`to_account_id` integer,
	`to_amount` integer,
	`rate` text NOT NULL,
	`base_amount` integer NOT NULL,
	`counterparty_id` integer,
	`comment` text,
	`created_by` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counterparty_id`) REFERENCES `counterparties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `operations_company_paid_idx` ON `operations` (`company_id`,`paid_at`,`id`);--> statement-breakpoint
CREATE INDEX `operations_account_idx` ON `operations` (`account_id`);--> statement-breakpoint
CREATE INDEX `operations_to_account_idx` ON `operations` (`to_account_id`);--> statement-breakpoint
CREATE INDEX `operations_counterparty_idx` ON `operations` (`counterparty_id`);