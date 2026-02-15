ALTER TABLE `artifact_stars` RENAME TO `artifact_favs`;--> statement-breakpoint
ALTER TABLE `user` RENAME COLUMN "name" TO "displayName";--> statement-breakpoint
ALTER TABLE `user` RENAME COLUMN "image" TO "avatarUrl";--> statement-breakpoint
ALTER TABLE `artifact_stats` RENAME COLUMN "star_count" TO "fav_count";--> statement-breakpoint
ALTER TABLE `artifact_stats` RENAME COLUMN "fork_count" TO "ref_count";--> statement-breakpoint
CREATE TABLE `resource_access_control` (
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`is_private` integer DEFAULT true NOT NULL,
	`is_listed` integer DEFAULT false NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`resource_type`, `resource_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_rac_owner` ON `resource_access_control` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_rac_listing` ON `resource_access_control` (`resource_type`,`is_private`,`is_listed`);--> statement-breakpoint
CREATE INDEX `idx_rac_type_owner` ON `resource_access_control` (`resource_type`,`owner_id`);--> statement-breakpoint
CREATE TABLE `resource_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text,
	`usage_limit` integer,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`label` text,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_access_tokens_token_unique` ON `resource_access_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_access_tokens_resource` ON `resource_access_tokens` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_access_tokens_token` ON `resource_access_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_access_tokens_creator` ON `resource_access_tokens` (`created_by`);--> statement-breakpoint
CREATE TABLE `article_save_refs` (
	`article_id` text NOT NULL,
	`save_commit` text NOT NULL,
	PRIMARY KEY(`article_id`, `save_commit`),
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_article_save_refs_save` ON `article_save_refs` (`save_commit`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifact_favs` (
	`user_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `artifact_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_artifact_favs`("user_id", "artifact_id", "created_at") SELECT "user_id", "artifact_id", "created_at" FROM `artifact_favs`;--> statement-breakpoint
DROP TABLE `artifact_favs`;--> statement-breakpoint
ALTER TABLE `__new_artifact_favs` RENAME TO `artifact_favs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_stars_user` ON `artifact_favs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_stars_artifact` ON `artifact_favs` (`artifact_id`);--> statement-breakpoint
DROP INDEX `idx_artifacts_visibility`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `visibility`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `is_archived`;--> statement-breakpoint
DROP INDEX `idx_collections_visibility`;--> statement-breakpoint
ALTER TABLE `collections` DROP COLUMN `visibility`;--> statement-breakpoint
DROP INDEX `idx_articles_visibility`;--> statement-breakpoint
ALTER TABLE `articles` DROP COLUMN `visibility`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `visibility`;--> statement-breakpoint
ALTER TABLE `node_versions` DROP COLUMN `visibility`;