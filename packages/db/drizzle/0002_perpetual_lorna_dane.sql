ALTER TABLE `articles` ADD `save_id` text NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_articles_save` ON `articles` (`save_id`);