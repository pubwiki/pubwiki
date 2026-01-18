-- Add checkpoint tables for efficient historical version export
CREATE TABLE `checkpoints` (
	`ref` text PRIMARY KEY NOT NULL,
	`timestamp` integer NOT NULL,
	`quad_count` integer NOT NULL,
	`name` text,
	`description` text
);
--> statement-breakpoint
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
