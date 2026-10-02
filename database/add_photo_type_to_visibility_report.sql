-- Migration: Add photoType column to VisibilityReport table
-- Date: 2024-12-XX
-- Description: Add photoType column to store the type/category of photos in visibility reports

-- Add photoType column if it doesn't exist
ALTER TABLE VisibilityReport 
ADD COLUMN IF NOT EXISTS photoType VARCHAR(100) DEFAULT NULL;

-- Add index for better query performance if needed
-- CREATE INDEX IF NOT EXISTS idx_photo_type ON VisibilityReport(photoType);
