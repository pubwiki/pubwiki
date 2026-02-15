CREATE TABLE `resource_discovery_control` (
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`is_listed` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`resource_type`, `resource_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_rdc_listing` ON `resource_discovery_control` (`resource_type`,`is_listed`);--> statement-breakpoint
CREATE TABLE `resource_acl` (
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`user_id` text NOT NULL,
	`can_read` integer DEFAULT false NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`can_manage` integer DEFAULT false NOT NULL,
	`granted_by` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`resource_type`, `resource_id`, `user_id`),
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_acl_user` ON `resource_acl` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_acl_resource` ON `resource_acl` (`resource_type`,`resource_id`);