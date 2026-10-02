-- Migration: Add location_locked field to JourneyPlan table
-- Date: 2024-12-20
-- Description: Add location_locked field to store the client's location lock status at the time of journey plan creation

-- Add location_locked field
ALTER TABLE JourneyPlan ADD COLUMN IF NOT EXISTS location_locked TINYINT(1) DEFAULT 0;

-- Update existing records to have default value (unlocked)
UPDATE JourneyPlan SET location_locked = 0 WHERE location_locked IS NULL;
