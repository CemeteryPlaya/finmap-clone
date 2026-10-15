DROP INDEX `stock_docs_source_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `stock_docs_source_uq` ON `stock_docs` (`company_id`,`source`,`source_ref`);--> statement-breakpoint
CREATE INDEX `stock_batches_source_idx` ON `stock_batches` (`source_batch_id`);