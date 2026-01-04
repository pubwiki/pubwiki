CREATE TABLE `project_artifacts` (
	`project_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`role_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`project_id`, `artifact_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `project_roles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_artifacts_project` ON `project_artifacts` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_artifacts_artifact` ON `project_artifacts` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_project_artifacts_role` ON `project_artifacts` (`role_id`);--> statement-breakpoint
CREATE TABLE `project_maintainers` (
	`project_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`project_id`, `user_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_maintainers_project` ON `project_maintainers` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_maintainers_user` ON `project_maintainers` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text(50) NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_roles_project` ON `project_roles` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`topic` text(100) NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_projects_owner` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_topic` ON `projects` (`topic`);