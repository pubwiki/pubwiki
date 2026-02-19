ALTER TABLE `artifacts` ADD `latest_version` text;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `current_version_id`;--> statement-breakpoint
ALTER TABLE `artifacts` DROP COLUMN `repository_url`;