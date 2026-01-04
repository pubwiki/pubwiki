CREATE TABLE `artifact_node_files` (
	`id` text PRIMARY KEY NOT NULL,
	`node_version_id` text NOT NULL,
	`filepath` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`checksum` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_version_id`) REFERENCES `artifact_node_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_node_files_version` ON `artifact_node_files` (`node_version_id`);--> statement-breakpoint
CREATE INDEX `idx_node_files_path` ON `artifact_node_files` (`node_version_id`,`filepath`);--> statement-breakpoint
CREATE TABLE `artifact_node_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_version_id` text NOT NULL,
	`external_node_id` text NOT NULL,
	`external_artifact_id` text NOT NULL,
	`external_node_version_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`external_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_node_refs_version` ON `artifact_node_refs` (`artifact_version_id`);--> statement-breakpoint
CREATE INDEX `idx_node_refs_external_artifact` ON `artifact_node_refs` (`external_artifact_id`);--> statement-breakpoint
CREATE TABLE `artifact_node_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`commit_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `artifact_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_node_versions_node` ON `artifact_node_versions` (`node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_node_versions_hash` ON `artifact_node_versions` (`node_id`,`commit_hash`);--> statement-breakpoint
CREATE TABLE `artifact_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_nodes_artifact` ON `artifact_nodes` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_nodes_type` ON `artifact_nodes` (`type`);--> statement-breakpoint
DROP TABLE `artifact_files`;--> statement-breakpoint
ALTER TABLE `artifact_versions` ADD `commit_hash` text NOT NULL;--> statement-breakpoint
ALTER TABLE `artifact_versions` ADD `edges` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_commit` ON `artifact_versions` (`artifact_id`,`commit_hash`);