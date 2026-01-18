CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`predicate` text NOT NULL,
	`object` text NOT NULL,
	`object_datatype` text,
	`object_language` text,
	`graph` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_quads_unique` ON `quads` (`subject`,`predicate`,`object`,`object_datatype`,`graph`);--> statement-breakpoint
CREATE INDEX `idx_quads_subject` ON `quads` (`subject`);--> statement-breakpoint
CREATE INDEX `idx_quads_predicate` ON `quads` (`predicate`);--> statement-breakpoint
CREATE INDEX `idx_quads_graph` ON `quads` (`graph`);--> statement-breakpoint
CREATE INDEX `idx_quads_sp` ON `quads` (`subject`,`predicate`);--> statement-breakpoint
CREATE TABLE `version_dag` (
	`ref` text PRIMARY KEY NOT NULL,
	`parent` text,
	`operation` text NOT NULL,
	`timestamp` integer NOT NULL
);
