CREATE TABLE `senet_tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`at` text NOT NULL,
	`guest_login` text DEFAULT '' NOT NULL,
	`phone_hash` text,
	`phone_mask` text,
	`ticket` text NOT NULL,
	`price` integer NOT NULL,
	`minutes` integer,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_tickets_office_at_idx` ON `senet_tickets` (`office_id`,`at`);