CREATE TABLE `cloud_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`sandbox_node_id` text,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_synced_at` text,
	`current_ref` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_saves_user` ON `cloud_saves` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_cloud_saves_sandbox` ON `cloud_saves` (`sandbox_node_id`);