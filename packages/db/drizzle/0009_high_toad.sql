PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_artifact_commit_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`commit_hash` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_artifact_commit_tags`("id", "artifact_id", "commit_hash", "tag", "created_at") SELECT "id", "artifact_id", "commit_hash", "tag", "created_at" FROM `artifact_commit_tags`;--> statement-breakpoint
DROP TABLE `artifact_commit_tags`;--> statement-breakpoint
ALTER TABLE `__new_artifact_commit_tags` RENAME TO `artifact_commit_tags`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_commit_tags_unique` ON `artifact_commit_tags` (`artifact_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_artifact_commit_tags_version` ON `artifact_commit_tags` (`commit_hash`);--> statement-breakpoint
CREATE TABLE `__new_artifact_version_edges` (
	`commit_hash` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`source_handle` text,
	`target_handle` text,
	PRIMARY KEY(`commit_hash`, `source_node_id`, `target_node_id`)
);
--> statement-breakpoint
INSERT INTO `__new_artifact_version_edges`("commit_hash", "source_node_id", "target_node_id", "source_handle", "target_handle") SELECT "commit_hash", "source_node_id", "target_node_id", "source_handle", "target_handle" FROM `artifact_version_edges`;--> statement-breakpoint
DROP TABLE `artifact_version_edges`;--> statement-breakpoint
ALTER TABLE `__new_artifact_version_edges` RENAME TO `artifact_version_edges`;--> statement-breakpoint
CREATE INDEX `idx_artifact_version_edges_version` ON `artifact_version_edges` (`commit_hash`);--> statement-breakpoint
CREATE TABLE `__new_artifact_version_nodes` (
	`commit_hash` text NOT NULL,
	`node_id` text NOT NULL,
	`node_commit` text NOT NULL,
	`position_x` integer,
	`position_y` integer,
	PRIMARY KEY(`commit_hash`, `node_id`)
);
--> statement-breakpoint
INSERT INTO `__new_artifact_version_nodes`("commit_hash", "node_id", "node_commit", "position_x", "position_y") SELECT "commit_hash", "node_id", "node_commit", "position_x", "position_y" FROM `artifact_version_nodes`;--> statement-breakpoint
DROP TABLE `artifact_version_nodes`;--> statement-breakpoint
ALTER TABLE `__new_artifact_version_nodes` RENAME TO `artifact_version_nodes`;--> statement-breakpoint
CREATE INDEX `idx_artifact_version_nodes_version` ON `artifact_version_nodes` (`commit_hash`);--> statement-breakpoint
CREATE INDEX `idx_artifact_version_nodes_node` ON `artifact_version_nodes` (`node_id`,`node_commit`);