CREATE TABLE `save_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`quad_count` integer NOT NULL,
	`title` text,
	`description` text,
	`ref_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
DROP TABLE `artifact_generation_params`;--> statement-breakpoint
DROP TABLE `artifact_lineage`;--> statement-breakpoint
DROP INDEX `idx_artifacts_type`;--> statement-breakpoint
DROP INDEX `idx_artifacts_slug`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `slug`;--> statement-breakpoint
DROP INDEX `idx_articles_sandbox`;--> statement-breakpoint
ALTER TABLE `articles` ADD `artifact_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `artifact_commit` text NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_articles_artifact` ON `articles` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_artifact_commit` ON `articles` (`artifact_id`,`artifact_commit`);--> statement-breakpoint
ALTER TABLE `articles` DROP COLUMN `sandbox_node_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` text(50),
	`commit_hash` text NOT NULL,
	`changelog` text,
	`is_prerelease` integer DEFAULT false NOT NULL,
	`published_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`metadata` text,
	`checksum` text(64),
	`entrypoint` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_artifact_versions`("id", "artifact_id", "version", "commit_hash", "changelog", "is_prerelease", "published_at", "created_at", "metadata", "checksum", "entrypoint") SELECT "id", "artifact_id", "version", "commit_hash", "changelog", "is_prerelease", "published_at", "created_at", "metadata", "checksum", "entrypoint" FROM `artifact_versions`;--> statement-breakpoint
DROP TABLE `artifact_versions`;--> statement-breakpoint
ALTER TABLE `__new_artifact_versions` RENAME TO `artifact_versions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_artifact` ON `artifact_versions` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_version` ON `artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_commit` ON `artifact_versions` (`artifact_id`,`commit_hash`);--> statement-breakpoint
ALTER TABLE `node_versions` ADD `source_artifact_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `node_versions` ADD `derivative_of` text;--> statement-breakpoint
CREATE INDEX `idx_node_versions_source_artifact` ON `node_versions` (`source_artifact_id`);--> statement-breakpoint
ALTER TABLE `state_contents` ADD `saves` text;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `is_admin`;