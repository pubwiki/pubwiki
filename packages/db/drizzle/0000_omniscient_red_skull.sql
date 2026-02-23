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
	`displayName` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`avatarUrl` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`username` text(50) NOT NULL,
	`display_username` text(50),
	`bio` text,
	`website` text(255),
	`location` text(100),
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
CREATE TABLE `artifact_commit_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`commit_hash` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_commit_tags_unique` ON `artifact_commit_tags` (`artifact_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_artifact_commit_tags_version` ON `artifact_commit_tags` (`commit_hash`);--> statement-breakpoint
CREATE TABLE `artifact_tags` (
	`artifact_id` text NOT NULL,
	`tag_slug` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`artifact_id`, `tag_slug`),
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_slug`) REFERENCES `tags`(`slug`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_tags_artifact` ON `artifact_tags` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_tags_tag` ON `artifact_tags` (`tag_slug`);--> statement-breakpoint
CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`version` text(50),
	`commit_hash` text NOT NULL,
	`changelog` text,
	`published_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`metadata` text,
	`checksum` text(64),
	`entrypoint` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_artifact` ON `artifact_versions` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_artifact_versions_version` ON `artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_artifact_versions_commit` ON `artifact_versions` (`artifact_id`,`commit_hash`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`author_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`description` text,
	`latest_version` text,
	`thumbnail_url` text(500),
	`license` text(50),
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_artifacts_author` ON `artifacts` (`author_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`slug` text(50) PRIMARY KEY NOT NULL,
	`name` text(50) NOT NULL,
	`description` text,
	`color` text(7),
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE INDEX `idx_tags_usage` ON `tags` (`usage_count`);--> statement-breakpoint
CREATE TABLE `artifact_favs` (
	`user_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`user_id`, `artifact_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_stars_user` ON `artifact_favs` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_stars_artifact` ON `artifact_favs` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `artifact_stats` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`fav_count` integer DEFAULT 0 NOT NULL,
	`ref_count` integer DEFAULT 0 NOT NULL,
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
	`version` integer DEFAULT 1 NOT NULL,
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
	`item_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_collections_user` ON `collections` (`user_id`);--> statement-breakpoint
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
	`is_archived` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
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
	`artifact_id` text NOT NULL,
	`artifact_commit` text NOT NULL,
	`title` text(200) NOT NULL,
	`content` text NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`collections` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_articles_author` ON `articles` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_artifact` ON `articles` (`artifact_id`);--> statement-breakpoint
CREATE INDEX `idx_articles_artifact_commit` ON `articles` (`artifact_id`,`artifact_commit`);--> statement-breakpoint
CREATE INDEX `idx_articles_created` ON `articles` (`created_at`);--> statement-breakpoint
CREATE TABLE `node_version_refs` (
	`source_commit` text NOT NULL,
	`target_commit` text NOT NULL,
	`ref_type` text NOT NULL,
	PRIMARY KEY(`source_commit`, `target_commit`, `ref_type`)
);
--> statement-breakpoint
CREATE INDEX `idx_node_version_refs_source` ON `node_version_refs` (`source_commit`);--> statement-breakpoint
CREATE INDEX `idx_node_version_refs_target` ON `node_version_refs` (`target_commit`);--> statement-breakpoint
CREATE TABLE `node_versions` (
	`node_id` text NOT NULL,
	`commit` text PRIMARY KEY NOT NULL,
	`parent` text,
	`author_id` text NOT NULL,
	`authored_at` text DEFAULT (datetime('now')) NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`content_hash` text NOT NULL,
	`source_artifact_id` text NOT NULL,
	`derivative_of` text,
	`message` text,
	`tag` text,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_node_versions_node` ON `node_versions` (`node_id`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_author` ON `node_versions` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_content` ON `node_versions` (`type`,`content_hash`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_tag` ON `node_versions` (`node_id`,`tag`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_parent` ON `node_versions` (`parent`);--> statement-breakpoint
CREATE INDEX `idx_node_versions_source_artifact` ON `node_versions` (`source_artifact_id`);--> statement-breakpoint
CREATE TABLE `generated_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`blocks` text NOT NULL,
	`plain_text` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `input_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`blocks` text NOT NULL,
	`generation_config` text,
	`plain_text` text,
	`reftag_names` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `loader_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`blocks` text NOT NULL,
	`plain_text` text,
	`reftag_names` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sandbox_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`entry_file` text DEFAULT 'index.html' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `save_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`state_node_id` text NOT NULL,
	`state_node_commit` text NOT NULL,
	`artifact_id` text NOT NULL,
	`artifact_commit` text NOT NULL,
	`quads_hash` text NOT NULL,
	`title` text,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_save_contents_state_node` ON `save_contents` (`state_node_id`);--> statement-breakpoint
CREATE INDEX `idx_save_contents_quads_hash` ON `save_contents` (`quads_hash`);--> statement-breakpoint
CREATE TABLE `state_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vfs_contents` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`mounts` text,
	`files_hash` text NOT NULL,
	`file_count` integer,
	`total_size` integer,
	`file_tree` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vfs_contents_files_hash` ON `vfs_contents` (`files_hash`);--> statement-breakpoint
CREATE TABLE `artifact_version_edges` (
	`commit_hash` text NOT NULL,
	`source_node_id` text NOT NULL,
	`target_node_id` text NOT NULL,
	`source_handle` text,
	`target_handle` text,
	PRIMARY KEY(`commit_hash`, `source_node_id`, `target_node_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_version_edges_version` ON `artifact_version_edges` (`commit_hash`);--> statement-breakpoint
CREATE TABLE `artifact_version_nodes` (
	`commit_hash` text NOT NULL,
	`node_id` text NOT NULL,
	`node_commit` text NOT NULL,
	`position_x` integer,
	`position_y` integer,
	PRIMARY KEY(`commit_hash`, `node_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_artifact_version_nodes_version` ON `artifact_version_nodes` (`commit_hash`);--> statement-breakpoint
CREATE INDEX `idx_artifact_version_nodes_node` ON `artifact_version_nodes` (`node_id`,`node_commit`);--> statement-breakpoint
CREATE TABLE `resource_access_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`token` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text,
	`usage_limit` integer,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`label` text,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_access_tokens_token_unique` ON `resource_access_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_access_tokens_resource` ON `resource_access_tokens` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `idx_access_tokens_token` ON `resource_access_tokens` (`token`);--> statement-breakpoint
CREATE INDEX `idx_access_tokens_creator` ON `resource_access_tokens` (`created_by`);--> statement-breakpoint
CREATE TABLE `article_save_refs` (
	`article_id` text NOT NULL,
	`save_commit` text NOT NULL,
	PRIMARY KEY(`article_id`, `save_commit`),
	FOREIGN KEY (`article_id`) REFERENCES `articles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_article_save_refs_save` ON `article_save_refs` (`save_commit`);--> statement-breakpoint
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