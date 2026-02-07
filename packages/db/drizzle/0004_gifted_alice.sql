DROP TABLE `artifact_node_refs`;--> statement-breakpoint
DROP TABLE `artifact_node_versions`;--> statement-breakpoint
DROP TABLE `artifact_nodes`;--> statement-breakpoint
DROP TABLE `cloud_saves`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_articles` (
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
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_articles`("id", "author_id", "sandbox_node_id", "title", "content", "visibility", "likes", "collections", "created_at", "updated_at") SELECT "id", "author_id", "sandbox_node_id", "title", "content", "visibility", "likes", "collections", "created_at", "updated_at" FROM `articles`;--> statement-breakpoint
DROP TABLE `articles`;--> statement-breakpoint
ALTER TABLE `__new_articles` RENAME TO `articles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_articles_author` ON `articles` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_sandbox` ON `articles` (`sandbox_node_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_visibility` ON `articles` (`visibility`);--> statement-breakpoint
CREATE INDEX `idx_articles_created` ON `articles` (`created_at`);--> statement-breakpoint
ALTER TABLE `artifact_versions` DROP COLUMN `edges`;