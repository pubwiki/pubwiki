-- Add visibility column to checkpoints table
ALTER TABLE `checkpoints` ADD COLUMN `visibility` text DEFAULT 'PRIVATE' NOT NULL;
