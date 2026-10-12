CREATE TABLE `imports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`file_sha256` text NOT NULL,
	`status` text NOT NULL,
	`counts` text NOT NULL,
	`created` text NOT NULL,
	`account_changes` text NOT NULL,
	`undo_result` text,
	`created_at` text NOT NULL,
	`undone_at` text,
	`undone_by` integer,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`undone_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `imports_company_idx` ON `imports` (`company_id`,`id`);--> statement-breakpoint
ALTER TABLE `operations` ADD `import_id` integer REFERENCES imports(id);--> statement-breakpoint
CREATE INDEX `operations_import_idx` ON `operations` (`import_id`);