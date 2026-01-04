CREATE TABLE `project_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`icon` text(50),
	`content` text,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_pages_project` ON `project_pages` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_pages_order` ON `project_pages` (`project_id`,`order`);--> statement-breakpoint
ALTER TABLE `projects` ADD `homepage_id` text;