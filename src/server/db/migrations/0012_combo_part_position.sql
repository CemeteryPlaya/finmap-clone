ALTER TABLE `stock_combo_parts` ADD `position` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- порядок ввода состава комплекта был порядком rowid: переносим его в position
UPDATE `stock_combo_parts` SET `position` = (SELECT COUNT(*) FROM `stock_combo_parts` p WHERE p.`combo_id` = `stock_combo_parts`.`combo_id` AND p.rowid < `stock_combo_parts`.rowid);
