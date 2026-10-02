-- Add expected_weekly_coverage column to SalesRep table
ALTER TABLE SalesRep 
ADD COLUMN IF NOT EXISTS expected_weekly_coverage INT(11) DEFAULT NULL;
