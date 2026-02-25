-- FTS5 Full-Text Search for Artifacts
-- This migration adds full-text search capability for artifact name and description fields
-- 
-- Design: Uses 'searchable' flag to decouple FTS sync from optimistic lock checks.
-- The searchable flag is set to true AFTER optimistic lock validation passes,
-- which prevents FTS triggers from affecting the changes() count.

-- Add searchable column to artifacts table (defaults to false)
ALTER TABLE artifacts ADD COLUMN searchable INTEGER NOT NULL DEFAULT 0;

--> statement-breakpoint

-- Create standalone FTS5 virtual table with trigram tokenizer
-- trigram supports substring search for any language including Chinese
CREATE VIRTUAL TABLE artifacts_fts USING fts5(
  id UNINDEXED,
  name,
  description,
  tokenize = 'trigram'
);

--> statement-breakpoint

-- UPDATE trigger: sync to FTS when searchable becomes true or content changes while searchable
-- This fires AFTER the optimistic lock check has passed
CREATE TRIGGER artifacts_fts_au AFTER UPDATE ON artifacts 
WHEN new.searchable = 1
BEGIN
  -- Remove old entry if exists
  DELETE FROM artifacts_fts WHERE id = old.id;
  -- Insert new entry
  INSERT INTO artifacts_fts(id, name, description)
  VALUES (new.id, new.name, COALESCE(new.description, ''));
END;

--> statement-breakpoint

-- DELETE trigger: remove deleted artifacts from FTS table
CREATE TRIGGER artifacts_fts_ad AFTER DELETE ON artifacts BEGIN
  DELETE FROM artifacts_fts WHERE id = old.id;
END;

--> statement-breakpoint

-- Initialize FTS table with existing searchable artifacts data
INSERT INTO artifacts_fts(id, name, description)
SELECT id, name, COALESCE(description, '') FROM artifacts WHERE searchable = 1;

--> statement-breakpoint

-- Set all existing artifacts as searchable (for migration only)
UPDATE artifacts SET searchable = 1;
