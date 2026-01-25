-- Drop old checkpoint tables (breaking change)
DROP TABLE IF EXISTS `checkpoint_quads`;
--> statement-breakpoint
DROP TABLE IF EXISTS `checkpoints`;
--> statement-breakpoint
-- Create new checkpoints table with id as primary key
CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`ref` text NOT NULL,
	`timestamp` integer NOT NULL,
	`quad_count` integer NOT NULL,
	`name` text,
	`description` text,
	`visibility` text DEFAULT 'PRIVATE' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_checkpoints_ref` ON `checkpoints` (`ref`);
--> statement-breakpoint
-- Recreate checkpoint_quads table
CREATE TABLE `checkpoint_quads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`checkpoint_ref` text NOT NULL,
	`subject` text NOT NULL,
	`predicate` text NOT NULL,
	`object` text NOT NULL,
	`object_datatype` text,
	`object_language` text,
	`graph` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_checkpoint_quads_ref` ON `checkpoint_quads` (`checkpoint_ref`);