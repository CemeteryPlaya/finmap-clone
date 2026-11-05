CREATE TABLE `senet_zones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`zone` text NOT NULL,
	`seats` integer NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `senet_zones_office_zone_uq` ON `senet_zones` (`office_id`,`zone`);