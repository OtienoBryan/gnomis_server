-- Migration script to add role column to SalesRep table
-- This script adds the role column to distinguish between 'sales rep' and 'team leader'

-- Add role column to SalesRep table
ALTER TABLE SalesRep 
ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'sales rep';

-- Update existing records to have 'sales rep' as default role if NULL
UPDATE SalesRep 
SET role = 'sales rep' 
WHERE role IS NULL OR role = '';
