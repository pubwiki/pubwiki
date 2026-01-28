-- Migration: Pure Checkpoint Storage Mode
-- Remove quads and version_dag tables (no more current state maintenance)
-- Simplify checkpoint_quads to use checkpoint_id instead of checkpoint_ref

-- Drop the old tables that are no longer needed
DROP TABLE IF EXISTS `quads`;
--> statement-breakpoint
DROP TABLE IF EXISTS `version_dag`;
--> statement-breakpoint
-- Drop and recreate checkpoint tables with new schema
DROP TABLE IF EXISTS `checkpoint_quads`;
--> statement-breakpoint
DROP TABLE IF EXISTS `checkpoints`;
--> statement-breakpoint
-- Create new checkpoints table (no ref column)
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`quad_count` integer NOT NULL,
	`name` text,
	`description` text,
	`visibility` text DEFAULT 'PRIVATE' NOT NULL
);
--> statement-breakpoint
-- Create new checkpoint_quads table (using checkpoint_id, no objectDatatype/objectLanguage)
CREATE TABLE `checkpoint_quads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checkpoint_id` text NOT NULL,
	`subject` text NOT NULL,
	`predicate` text NOT NULL,
	`object` text NOT NULL,
	`graph` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_checkpoint_quads_id` ON `checkpoint_quads` (`checkpoint_id`);
