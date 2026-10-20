CREATE TABLE `audit_undo` (
	`audit_id` integer PRIMARY KEY NOT NULL,
	`undo_id` integer NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audit_log`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`undo_id`) REFERENCES `audit_log`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`company_id`,`entity`,`entity_id`);