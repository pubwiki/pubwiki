-- WikiFarm schema (managed by MediaWiki extension)
-- Engine: InnoDB; Charset: utf8mb4

CREATE TABLE IF NOT EXISTS `wikifarm_wikis` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(190) NOT NULL,
  `slug` VARCHAR(120) NOT NULL,
  `domain` VARCHAR(190) NULL,
  `path` VARCHAR(190) NULL,
  `language` VARCHAR(32) NOT NULL,
  `owner_user_id` INT UNSIGNED NOT NULL,
  `owner_username` VARBINARY(255) NOT NULL,
  `visibility` ENUM('public','private','unlisted') NOT NULL DEFAULT 'public',
  `status` ENUM('pending','ready','failed','deleting') NOT NULL DEFAULT 'pending',
  `is_featured` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_slug` (`slug`),
  KEY `idx_owner_user_id` (`owner_user_id`),
  KEY `idx_is_featured_ready` (`is_featured`, `status`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wikifarm_tasks` (
  `id` CHAR(36) NOT NULL,
  `type` ENUM('create_wiki') NOT NULL,
  `status` ENUM('queued','running','succeeded','failed') NOT NULL,
  `progress` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `message` TEXT NULL,
  `wiki_id` BIGINT UNSIGNED NULL,
  `created_by_user_id` INT UNSIGNED NOT NULL,
  `created_by_username` VARBINARY(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `started_at` DATETIME NULL,
  `finished_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_wiki_id` (`wiki_id`),
  CONSTRAINT `fk_tasks_wiki` FOREIGN KEY (`wiki_id`) REFERENCES `wikifarm_wikis`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-wiki group permissions (synced to generated permissions.php)
CREATE TABLE IF NOT EXISTS `wikifarm_wiki_group_permissions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `wiki_id` BIGINT UNSIGNED NOT NULL,
  `group_name` VARCHAR(64) NOT NULL,
  `permission` VARCHAR(64) NOT NULL,
  `allowed` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_wiki_group_perm` (`wiki_id`,`group_name`,`permission`),
  KEY `idx_wiki_id` (`wiki_id`),
  KEY `idx_group_name` (`group_name`),
  CONSTRAINT `fk_group_perms_wiki` FOREIGN KEY (`wiki_id`) REFERENCES `wikifarm_wikis`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
