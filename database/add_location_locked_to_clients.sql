-- Migration: Add location_locked field to Clients table
-- Date: 2024-12-20
-- Description: Add location_locked field to prevent accidental changes to client location coordinates

-- Add location_locked field
ALTER TABLE Clients ADD COLUMN IF NOT EXISTS location_locked TINYINT(1) DEFAULT 0;

-- Update existing records to have default value (unlocked)
UPDATE Clients SET location_locked = 0 WHERE location_locked IS NULL;
