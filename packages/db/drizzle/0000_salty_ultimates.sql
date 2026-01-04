CREATE TABLE `user_follows` (
	`follower_id` text NOT NULL,
	`following_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`follower_id`, `following_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`following_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_follows_follower` ON `user_follows` (`follower_id`);--> statement-breakpoint
CREATE INDEX `idx_user_follows_following` ON `user_follows` (`following_id`);--> statement-breakpoint
CREATE TABLE `user_oauth` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text(50) NOT NULL,
	`provider_user_id` text(255) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_oauth_user` ON `user_oauth` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_oauth_provider` ON `user_oauth` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text(50) NOT NULL,
	`display_name` text(100),
	`email` text(255) NOT NULL,
	`password_hash` text(255) NOT NULL,
	`avatar_url` text(500),
	`bio` text,
	`website` text(255),
	`location` text(100),
	`is_verified` integer DEFAULT false NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_login_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `artifact_files` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`filename` text(255) NOT NULL,
	`filepath` text(500) NOT NULL,
	`mime_type` text(100),
	`size_bytes` integer,
	`content` text,
	`storage_uri` text(500),
	`checksum` text(64),
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_files_version` ON `artifact_files` (`version_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_files_path` ON `artifact_files` (`version_id`,`filepath`);--> statement-breakpoint
CREATE TABLE `artifact_tags` (
	`artifact_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`artifact_id`, `tag_id`),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_tags_artifact` ON `artifact_tags` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_tags_tag` ON `artifact_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` text(50) NOT NULL,
	`changelog` text,
	`is_prerelease` integer DEFAULT false NOT NULL,
	`published_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`metadata` text,
	`checksum` text(64),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_artifact` ON `artifact_versions` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_version` ON `artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text(100) NOT NULL,
	`slug` text(100) NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`current_version_id` text,
	`thumbnail_url` text(500),
	`license` text(50),
	`repository_url` text(500),
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_author` ON `artifacts` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_type` ON `artifacts` (`type`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_slug` ON `artifacts` (`author_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_artifacts_visibility` ON `artifacts` (`visibility`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text(50) NOT NULL,
	`slug` text(50) NOT NULL,
	`description` text,
	`color` text(7),
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `tags_slug_unique` ON `tags` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_tags_slug` ON `tags` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_tags_usage` ON `tags` (`usage_count`);--> statement-breakpoint
CREATE TABLE `artifact_generation_params` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`model_provider` text(50) NOT NULL,
	`model_name` text(100) NOT NULL,
	`parameters` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_gen_params_version` ON `artifact_generation_params` (`version_id`);--> statement-breakpoint
CREATE INDEX `idx_gen_params_model` ON `artifact_generation_params` (`model_provider`,`model_name`);--> statement-breakpoint
CREATE TABLE `artifact_lineage` (
	`id` text PRIMARY KEY NOT NULL,
	`child_artifact_id` text NOT NULL,
	`parent_artifact_id` text NOT NULL,
	`lineage_type` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`child_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_lineage_child` ON `artifact_lineage` (`child_artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_lineage_parent` ON `artifact_lineage` (`parent_artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_lineage_type` ON `artifact_lineage` (`lineage_type`);--> statement-breakpoint
CREATE TABLE `artifact_stars` (
	`user_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `artifact_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stars_user` ON `artifact_stars` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_stars_artifact` ON `artifact_stars` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `artifact_stats` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`star_count` integer DEFAULT 0 NOT NULL,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`download_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `artifact_views` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`user_id` text,
	`ip_hash` text(64),
	`user_agent` text(500),
	`referer` text(500),
	`viewed_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_views_artifact` ON `artifact_views` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_views_user` ON `artifact_views` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_views_time` ON `artifact_views` (`viewed_at`);--> statement-breakpoint
CREATE TABLE `discussion_replies` (
	`id` text PRIMARY KEY NOT NULL,
	`discussion_id` text NOT NULL,
	`author_id` text NOT NULL,
	`parent_reply_id` text,
	`content` text NOT NULL,
	`is_accepted` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_replies_discussion` ON `discussion_replies` (`discussion_id`);--> statement-breakpoint
CREATE INDEX `idx_replies_author` ON `discussion_replies` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_replies_parent` ON `discussion_replies` (`parent_reply_id`);--> statement-breakpoint
CREATE TABLE `discussions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`author_id` text NOT NULL,
	`title` text(200),
	`content` text NOT NULL,
	`category` text DEFAULT 'GENERAL' NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`is_locked` integer DEFAULT false NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_discussions_artifact` ON `discussions` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_discussions_author` ON `discussions` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_discussions_category` ON `discussions` (`category`);--> statement-breakpoint
CREATE INDEX `idx_discussions_pinned` ON `discussions` (`is_pinned`);--> statement-breakpoint
CREATE TABLE `artifact_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version_id` text NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`input_params` text,
	`output_params` text,
	`error_message` text,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_runs_artifact` ON `artifact_runs` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_version` ON `artifact_runs` (`version_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_user` ON `artifact_runs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_runs_status` ON `artifact_runs` (`status`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text(200) NOT NULL,
	`content` text,
	`metadata` text,
	`is_read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_notifications_unread` ON `notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE INDEX `idx_notifications_type` ON `notifications` (`type`);--> statement-breakpoint
CREATE TABLE `artifact_collaborators` (
	`artifact_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'VIEWER' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`artifact_id`, `user_id`),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_collaborators_artifact` ON `artifact_collaborators` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_collaborators_user` ON `artifact_collaborators` (`user_id`);--> statement-breakpoint
CREATE TABLE `collection_items` (
	`collection_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`note` text,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`collection_id`, `artifact_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_collection_items_collection` ON `collection_items` (`collection_id`);--> statement-breakpoint
CREATE INDEX `idx_collection_items_artifact` ON `collection_items` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'PRIVATE' NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_collections_user` ON `collections` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_collections_visibility` ON `collections` (`visibility`);