-- Add original_node_id and original_commit fields to artifact_nodes table
-- These fields track the source when a node is forked from an external node
ALTER TABLE `artifact_nodes` ADD COLUMN `original_node_id` text;
--> statement-breakpoint
ALTER TABLE `artifact_nodes` ADD COLUMN `original_commit` text;
