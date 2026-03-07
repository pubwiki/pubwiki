CREATE TABLE `build_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`release_hash` text NOT NULL,
	`file_hashes` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `artifact_versions` ADD `build_cache_key` text;--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_build_cache` ON `artifact_versions` (`build_cache_key`);