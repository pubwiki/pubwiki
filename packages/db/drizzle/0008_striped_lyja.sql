PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_node_version_refs` (
	`source_commit` text NOT NULL,
	`target_commit` text NOT NULL,
	`ref_type` text NOT NULL,
	PRIMARY KEY(`source_commit`, `target_commit`, `ref_type`)
);
--> statement-breakpoint
INSERT INTO `__new_node_version_refs`("source_commit", "target_commit", "ref_type") SELECT "source_commit", "target_commit", "ref_type" FROM `node_version_refs`;--> statement-breakpoint
DROP TABLE `node_version_refs`;--> statement-breakpoint
ALTER TABLE `__new_node_version_refs` RENAME TO `node_version_refs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_node_version_refs_source` ON `node_version_refs` (`source_commit`);--> statement-breakpoint
CREATE INDEX `idx_node_version_refs_target` ON `node_version_refs` (`target_commit`);--> statement-breakpoint
CREATE TABLE `__new_node_versions` (
	`node_id` text NOT NULL,
	`commit` text PRIMARY KEY NOT NULL,
	`parent` text,
	`author_id` text NOT NULL,
	`authored_at` text DEFAULT (datetime('now')) NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`content_hash` text NOT NULL,
	`source_artifact_id` text NOT NULL,
	`derivative_of` text,
	`message` text,
	`tag` text,
	`visibility` text DEFAULT 'PRIVATE' NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_node_versions`("node_id", "commit", "parent", "author_id", "authored_at", "type", "name", "content_hash", "source_artifact_id", "derivative_of", "message", "tag", "visibility") SELECT "node_id", "commit", "parent", "author_id", "authored_at", "type", "name", "content_hash", "source_artifact_id", "derivative_of", "message", "tag", "visibility" FROM `node_versions`;--> statement-breakpoint
DROP TABLE `node_versions`;--> statement-breakpoint
ALTER TABLE `__new_node_versions` RENAME TO `node_versions`;--> statement-breakpoint
CREATE INDEX `idx_node_versions_node` ON `node_versions` (`node_id`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_author` ON `node_versions` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_content` ON `node_versions` (`type`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_tag` ON `node_versions` (`node_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_parent` ON `node_versions` (`parent`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_source_artifact` ON `node_versions` (`source_artifact_id`);