ALTER TABLE `projects` ADD `slug` text(100) NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `is_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_projects_slug` ON `projects` (`slug`);