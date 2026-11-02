CREATE TABLE `senet_goods_moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`from_at` text NOT NULL,
	`to_at` text NOT NULL,
	`source_order` text DEFAULT '' NOT NULL,
	`cashier` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`item` text NOT NULL,
	`restock_qty` integer DEFAULT 0 NOT NULL,
	`write_off_qty` integer DEFAULT 0 NOT NULL,
	`restock_price` integer,
	`restock_sum` integer DEFAULT 0 NOT NULL,
	`total_qty` integer,
	`sold_qty` integer DEFAULT 0 NOT NULL,
	`selling_price` integer,
	`sold_sum` integer DEFAULT 0 NOT NULL,
	`sold_cost` integer,
	`profit` integer,
	`comment` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_goods_moves_office_from_idx` ON `senet_goods_moves` (`office_id`,`from_at`);--> statement-breakpoint
CREATE TABLE `senet_load` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text,
	`zone` text DEFAULT '' NOT NULL,
	`workstation` integer,
	`guest_login` text DEFAULT '' NOT NULL,
	`phone_hash` text,
	`phone_mask` text,
	`age` integer,
	`tariff` text DEFAULT '' NOT NULL,
	`debited` integer DEFAULT 0 NOT NULL,
	`refilled` integer DEFAULT 0 NOT NULL,
	`duration_sec` integer,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_load_office_start_idx` ON `senet_load` (`office_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `senet_stock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`office_id` integer NOT NULL,
	`from_at` text NOT NULL,
	`to_at` text NOT NULL,
	`item` text NOT NULL,
	`sold_qty` integer DEFAULT 0 NOT NULL,
	`restock_qty` integer DEFAULT 0 NOT NULL,
	`write_off_qty` integer DEFAULT 0 NOT NULL,
	`restock_price` integer,
	`restock_sum` integer DEFAULT 0 NOT NULL,
	`selling_price` integer,
	`sold_sum` integer DEFAULT 0 NOT NULL,
	`actual_qty` integer,
	FOREIGN KEY (`office_id`) REFERENCES `senet_offices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `senet_stock_office_from_idx` ON `senet_stock` (`office_id`,`from_at`);