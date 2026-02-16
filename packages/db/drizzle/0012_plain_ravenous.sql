DROP TABLE `project_maintainers`;--> statement-breakpoint
DROP TABLE `resource_access_control`;--> statement-breakpoint
ALTER TABLE `discussions` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `version` integer DEFAULT 1 NOT NULL;