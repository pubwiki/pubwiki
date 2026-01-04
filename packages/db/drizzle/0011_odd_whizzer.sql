CREATE TABLE `project_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`author_id` text NOT NULL,
	`discussion_id` text,
	`title` text(200) NOT NULL,
	`content` text NOT NULL,
	`cover_urls` text,
	`is_pinned` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_posts_project` ON `project_posts` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_posts_author` ON `project_posts` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_project_posts_discussion` ON `project_posts` (`discussion_id`);--> statement-breakpoint
CREATE INDEX `idx_project_posts_pinned` ON `project_posts` (`project_id`,`is_pinned`);--> statement-breakpoint
CREATE INDEX `idx_project_posts_created` ON `project_posts` (`project_id`,`created_at`);