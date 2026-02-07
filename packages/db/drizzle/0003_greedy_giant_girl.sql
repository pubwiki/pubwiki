CREATE TABLE `node_version_refs` (
	`source_node_id` text NOT NULL,
	`source_commit` text NOT NULL,
	`target_node_id` text NOT NULL,
	`target_commit` text NOT NULL,
	`ref_type` text NOT NULL,
	PRIMARY KEY(`source_node_id`, `source_commit`, `target_node_id`, `target_commit`, `ref_type`)
);
--> statement-breakpoint
CREATE INDEX `idx_node_version_refs_source` ON `node_version_refs` (`source_node_id`,`source_commit`);--> statement-breakpoint
CREATE INDEX `idx_node_version_refs_target` ON `node_version_refs` (`target_node_id`,`target_commit`);--> statement-breakpoint
CREATE INDEX `idx_node_version_refs_type` ON `node_version_refs` (`ref_type`);--> statement-breakpoint
CREATE TABLE `node_versions` (
	`node_id` text NOT NULL,
	`commit` text NOT NULL,
	`parent` text,
	`author_id` text NOT NULL,
	`authored_at` text DEFAULT (datetime('now')) NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`content_hash` text NOT NULL,
	`message` text,
	`tag` text,
	`visibility` text DEFAULT 'PRIVATE' NOT NULL,
	PRIMARY KEY(`node_id`, `commit`),
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_node_versions_author` ON `node_versions` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_content` ON `node_versions` (`type`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_tag` ON `node_versions` (`node_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_parent` ON `node_versions` (`node_id`,`parent`);--> statement-breakpoint
CREATE TABLE `generated_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`blocks` text NOT NULL,
	`plain_text` text,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `input_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`blocks` text NOT NULL,
	`generation_config` text,
	`plain_text` text,
	`reftag_names` text,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loader_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`blocks` text NOT NULL,
	`plain_text` text,
	`reftag_names` text,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sandbox_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`entry_file` text DEFAULT 'index.html' NOT NULL,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `state_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`quad_count` integer,
	`title` text,
	`description` text,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vfs_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mounts` text,
	`file_count` integer,
	`total_size` integer,
	`file_tree` text,
	`ref_count` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `artifact_version_edges` (
	`artifact_version_id` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`source_handle` text,
	`target_handle` text,
	PRIMARY KEY(`artifact_version_id`, `source_node_id`, `target_node_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_version_edges_version` ON `artifact_version_edges` (`artifact_version_id`);--> statement-breakpoint
CREATE TABLE `artifact_version_nodes` (
	`artifact_version_id` text NOT NULL,
	`node_id` text NOT NULL,
	`node_commit` text NOT NULL,
	`position_x` integer,
	`position_y` integer,
	PRIMARY KEY(`artifact_version_id`, `node_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_version_nodes_version` ON `artifact_version_nodes` (`artifact_version_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_version_nodes_node` ON `artifact_version_nodes` (`node_id`,`node_commit`);