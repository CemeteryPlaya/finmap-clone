CREATE TABLE `senet_data_spans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`report` text NOT NULL,
	`from_at` text NOT NULL,
	`to_at` text NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_data_spans_office_report_idx` ON `senet_data_spans` (`office_id`,`report`,`from_at`);--> statement-breakpoint
-- отрезки по сырым файлам клубов (решение R2): повторы файлов в senet_raw не попали — их дни лечит «Загрузить за период»
INSERT INTO `senet_data_spans` (`office_id`, `report`, `from_at`, `to_at`) SELECT `office_id`, `report`, `from_date`, `to_date` FROM `senet_raw` WHERE `office_id` IS NOT NULL;
