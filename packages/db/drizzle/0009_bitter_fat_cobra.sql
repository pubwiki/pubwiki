PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_discussions` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text(200),
	`content` text NOT NULL,
	`category` text DEFAULT 'GENERAL' NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_discussions`("id", "target_type", "target_id", "author_id", "title", "content", "category", "is_pinned", "is_locked", "reply_count", "created_at", "updated_at") SELECT "id", "target_type", "target_id", "author_id", "title", "content", "category", "is_pinned", "is_locked", "reply_count", "created_at", "updated_at" FROM `discussions`;--> statement-breakpoint
DROP TABLE `discussions`;--> statement-breakpoint
ALTER TABLE `__new_discussions` RENAME TO `discussions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_discussions_target` ON `discussions` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_discussions_author` ON `discussions` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_discussions_category` ON `discussions` (`category`);--> statement-breakpoint
CREATE INDEX `idx_discussions_pinned` ON `discussions` (`is_pinned`);