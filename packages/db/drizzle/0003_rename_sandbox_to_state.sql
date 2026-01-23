-- Rename sandbox_node_id to state_node_id in cloud_saves table
ALTER TABLE `cloud_saves` RENAME COLUMN `sandbox_node_id` TO `state_node_id`;
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_cloud_saves_sandbox`;
--> statement-breakpoint
CREATE INDEX `idx_cloud_saves_state` ON `cloud_saves` (`state_node_id`);
