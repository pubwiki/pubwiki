ALTER TABLE `state_contents` ADD `name` text NOT NULL;--> statement-breakpoint
ALTER TABLE `state_contents` ADD `description` text;--> statement-breakpoint
ALTER TABLE `state_contents` DROP COLUMN `saves`;