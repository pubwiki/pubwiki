CREATE TABLE `artifact_commit_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`artifact_version_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_commit_tags_unique` ON `artifact_commit_tags` (`artifact_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_artifact_commit_tags_version` ON `artifact_commit_tags` (`artifact_version_id`);--> statement-breakpoint
DROP INDEX `idx_artifact_versions_commit_tag`;--> statement-breakpoint
ALTER TABLE `artifact_versions` ADD `is_weak` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `artifact_versions` DROP COLUMN `is_prerelease`;--> statement-breakpoint
ALTER TABLE `artifact_versions` DROP COLUMN `commit_tag`;