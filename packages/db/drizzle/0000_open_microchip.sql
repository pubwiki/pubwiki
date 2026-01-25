CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_account_user` ON `account` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_account_provider` ON `account` (`provider_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `idx_session_user` ON `session` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_session_token` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`username` text(50) NOT NULL,
	`display_username` text(50),
	`bio` text,
	`website` text(255),
	`location` text(100),
	`is_admin` integer DEFAULT false NOT NULL,
	`is_verified` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE INDEX `idx_user_username` ON `user` (`username`);--> statement-breakpoint
CREATE INDEX `idx_user_email` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_follows` (
	`follower_id` text NOT NULL,
	`following_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`follower_id`, `following_id`),
	FOREIGN KEY (`follower_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`following_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_user_follows_follower` ON `user_follows` (`follower_id`);--> statement-breakpoint
CREATE INDEX `idx_user_follows_following` ON `user_follows` (`following_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_verification_identifier` ON `verification` (`identifier`);--> statement-breakpoint
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
	`commit_hash` text NOT NULL,
	`changelog` text,
	`is_prerelease` integer DEFAULT false NOT NULL,
	`published_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`metadata` text,
	`edges` text,
	`checksum` text(64),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_artifact` ON `artifact_versions` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_version` ON `artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_commit` ON `artifact_versions` (`artifact_id`,`commit_hash`);--> statement-breakpoint
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
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
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
CREATE TABLE `artifact_node_files` (
	`id` text PRIMARY KEY NOT NULL,
	`node_version_id` text NOT NULL,
	`filepath` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`checksum` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_version_id`) REFERENCES `artifact_node_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_node_files_version` ON `artifact_node_files` (`node_version_id`);--> statement-breakpoint
CREATE INDEX `idx_node_files_path` ON `artifact_node_files` (`node_version_id`,`filepath`);--> statement-breakpoint
CREATE TABLE `artifact_node_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_version_id` text NOT NULL,
	`external_node_id` text NOT NULL,
	`external_artifact_id` text NOT NULL,
	`external_node_version_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_version_id`) REFERENCES `artifact_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`external_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_node_refs_version` ON `artifact_node_refs` (`artifact_version_id`);--> statement-breakpoint
CREATE INDEX `idx_node_refs_external_artifact` ON `artifact_node_refs` (`external_artifact_id`);--> statement-breakpoint
CREATE TABLE `artifact_node_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`commit_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `artifact_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_node_versions_node` ON `artifact_node_versions` (`node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_node_versions_hash` ON `artifact_node_versions` (`node_id`,`commit_hash`);--> statement-breakpoint
CREATE TABLE `artifact_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`position_x` integer,
	`position_y` integer,
	`original_node_id` text,
	`original_commit` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_nodes_artifact` ON `artifact_nodes` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_nodes_type` ON `artifact_nodes` (`type`);--> statement-breakpoint
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
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
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_replies_discussion` ON `discussion_replies` (`discussion_id`);--> statement-breakpoint
CREATE INDEX `idx_replies_author` ON `discussion_replies` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_replies_parent` ON `discussion_replies` (`parent_reply_id`);--> statement-breakpoint
CREATE TABLE `discussions` (
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
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_discussions_target` ON `discussions` (`target_type`,`target_id`);--> statement-breakpoint
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_collections_user` ON `collections` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_collections_visibility` ON `collections` (`visibility`);--> statement-breakpoint
CREATE TABLE `project_artifacts` (
	`project_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`role_id` text,
	`is_official` integer DEFAULT false NOT NULL,
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_maintainers_project` ON `project_maintainers` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_maintainers_user` ON `project_maintainers` (`user_id`);--> statement-breakpoint
CREATE TABLE `project_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`icon` text(50),
	`content` text,
	`order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_pages_project` ON `project_pages` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_pages_order` ON `project_pages` (`project_id`,`order`);--> statement-breakpoint
CREATE TABLE `project_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_role_id` text,
	`name` text(50) NOT NULL,
	`description` text,
	`is_leaf` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_roles_project` ON `project_roles` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_roles_parent` ON `project_roles` (`parent_role_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`slug` text(100) NOT NULL,
	`topic` text(100) NOT NULL,
	`description` text,
	`license` text(50),
	`cover_urls` text,
	`homepage_id` text,
	`visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_projects_owner` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_topic` ON `projects` (`topic`);--> statement-breakpoint
CREATE INDEX `idx_projects_slug` ON `projects` (`slug`);--> statement-breakpoint
CREATE TABLE `project_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`author_id` text NOT NULL,
	`discussion_id` text,
	`title` text(200) NOT NULL,
	`content` text NOT NULL,
	`cover_urls` text,
	`is_pinned` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discussion_id`) REFERENCES `discussions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_project_posts_project` ON `project_posts` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_posts_author` ON `project_posts` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_project_posts_discussion` ON `project_posts` (`discussion_id`);--> statement-breakpoint
CREATE INDEX `idx_project_posts_pinned` ON `project_posts` (`project_id`,`is_pinned`);--> statement-breakpoint
CREATE INDEX `idx_project_posts_created` ON `project_posts` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `articles` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`sandbox_node_id` text NOT NULL,
	`title` text(200) NOT NULL,
	`content` text NOT NULL,
	`visibility` text DEFAULT 'PUBLIC' NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`collections` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sandbox_node_id`) REFERENCES `artifact_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_articles_author` ON `articles` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_sandbox` ON `articles` (`sandbox_node_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_visibility` ON `articles` (`visibility`);--> statement-breakpoint
CREATE INDEX `idx_articles_created` ON `articles` (`created_at`);--> statement-breakpoint
CREATE TABLE `cloud_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`state_node_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_synced_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cloud_saves_user` ON `cloud_saves` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_cloud_saves_state` ON `cloud_saves` (`state_node_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cloud_saves_user_state` ON `cloud_saves` (`user_id`,`state_node_id`);