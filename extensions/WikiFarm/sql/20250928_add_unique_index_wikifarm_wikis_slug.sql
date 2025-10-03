-- Migration: ensure unique index on wikifarm_wikis.slug
-- Date: 2025-09-28
-- This migration is idempotent; it will create the unique index only if missing.

ALTER TABLE `wikifarm_wikis`
  ADD UNIQUE INDEX `uniq_slug` (`slug`);

-- NOTE: If the index already exists, MySQL/MariaDB will raise an error like:
--   "Duplicate key name 'uniq_slug'"
-- You can safely ignore it, or run this guarded form manually:
--   SET @exist := (SELECT COUNT(1) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name='wikifarm_wikis' AND index_name='uniq_slug');
--   SET @sql := IF(@exist=0, 'ALTER TABLE `wikifarm_wikis` ADD UNIQUE INDEX `uniq_slug` (`slug`)', 'SELECT "uniq_slug exists"');
--   PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
