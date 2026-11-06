CREATE TABLE `senet_guest_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company_id` integer NOT NULL,
	`key_a` text NOT NULL,
	`key_b` text NOT NULL,
	`kind` text NOT NULL,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senet_guest_links_uq` ON `senet_guest_links` (`company_id`,`kind`,`key_a`,`key_b`);