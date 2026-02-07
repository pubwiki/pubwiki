ALTER TABLE `artifact_versions` ADD `commit_tag` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_commit_tag` ON `artifact_versions` (`artifact_id`,`commit_tag`);--> statement-breakpoint
ALTER TABLE `save_contents` ADD `state_node_id` text NOT NULL;--> statement-breakpoint
ALTER TABLE `save_contents` ADD `state_node_commit` text NOT NULL;--> statement-breakpoint
ALTER TABLE `save_contents` ADD `source_artifact_commit` text NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_save_contents_state_node` ON `save_contents` (`state_node_id`);--> statement-breakpoint
ALTER TABLE `save_contents` DROP COLUMN `quad_count`;--> statement-breakpoint
ALTER TABLE `discussion_replies` DROP COLUMN `is_accepted`;--> statement-breakpoint
ALTER TABLE `state_contents` DROP COLUMN `quad_count`;--> statement-breakpoint
ALTER TABLE `state_contents` DROP COLUMN `title`;--> statement-breakpoint
ALTER TABLE `state_contents` DROP COLUMN `description`;