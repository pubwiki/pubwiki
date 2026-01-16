CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`sandbox_node_id` text NOT NULL,
	`title` text(200) NOT NULL,
	`content` text NOT NULL,
	`visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`collections` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sandbox_node_id`) REFERENCES `artifact_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_articles_author` ON `articles` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_sandbox` ON `articles` (`sandbox_node_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_visibility` ON `articles` (`visibility`);--> statement-breakpoint
CREATE INDEX `idx_articles_created` ON `articles` (`created_at`);