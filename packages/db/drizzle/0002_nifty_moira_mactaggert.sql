PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_save_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`state_node_id` text NOT NULL,
	`state_node_commit` text,
	`artifact_id` text NOT NULL,
	`artifact_commit` text NOT NULL,
	`quads_hash` text NOT NULL,
	`title` text,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_save_contents`("content_hash", "state_node_id", "state_node_commit", "artifact_id", "artifact_commit", "quads_hash", "title", "description", "created_at") SELECT "content_hash", "state_node_id", "state_node_commit", "artifact_id", "artifact_commit", "quads_hash", "title", "description", "created_at" FROM `save_contents`;--> statement-breakpoint
DROP TABLE `save_contents`;--> statement-breakpoint
ALTER TABLE `__new_save_contents` RENAME TO `save_contents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_save_contents_state_node` ON `save_contents` (`state_node_id`);--> statement-breakpoint
CREATE INDEX `idx_save_contents_quads_hash` ON `save_contents` (`quads_hash`);--> statement-breakpoint
CREATE TABLE `__new_artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` text(50),
	`commit_hash` text NOT NULL,
	`changelog` text,
	`published_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`metadata` text,
	`checksum` text(64),
	`entrypoint` text,
	`build_cache_key` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chk_entrypoint_requires_build_cache" CHECK(entrypoint IS NULL OR build_cache_key IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_artifact_versions`("id", "artifact_id", "version", "commit_hash", "changelog", "published_at", "created_at", "metadata", "checksum", "entrypoint", "build_cache_key") SELECT "id", "artifact_id", "version", "commit_hash", "changelog", "published_at", "created_at", "metadata", "checksum", "entrypoint", "build_cache_key" FROM `artifact_versions`;--> statement-breakpoint
DROP TABLE `artifact_versions`;--> statement-breakpoint
ALTER TABLE `__new_artifact_versions` RENAME TO `artifact_versions`;--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_artifact` ON `artifact_versions` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_version` ON `artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_commit` ON `artifact_versions` (`artifact_id`,`commit_hash`);--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_build_cache` ON `artifact_versions` (`build_cache_key`);