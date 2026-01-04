ALTER TABLE `project_artifacts` ADD `is_official` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_roles` ADD `parent_role_id` text;--> statement-breakpoint
CREATE INDEX `idx_project_roles_parent` ON `project_roles` (`parent_role_id`);