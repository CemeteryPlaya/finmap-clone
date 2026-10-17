CREATE TABLE `analytics_indicator_parts` (
	`company_id` integer NOT NULL,
	`part` text NOT NULL,
	`all_categories` integer NOT NULL,
	`category_ids` text NOT NULL,
	`include_stock` integer NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	PRIMARY KEY(`company_id`, `part`),
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
