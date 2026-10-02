-- Migration: Change planogram_compliance from percentage to quantity
-- Date: 2024-12-XX
-- Description: Change compliance_percentage column to compliance_quantity (INT instead of DECIMAL)

-- Check if column exists before altering
-- If the table doesn't exist yet, this migration will be handled by the ensureTableExists function

-- Drop the old column and add the new one
ALTER TABLE planogram_compliance 
DROP COLUMN IF EXISTS compliance_percentage,
ADD COLUMN compliance_quantity INT NOT NULL DEFAULT 0 CHECK (compliance_quantity >= 0);

-- Note: If you have existing data, you may want to convert it first:
-- UPDATE planogram_compliance SET compliance_quantity = ROUND(compliance_percentage) WHERE compliance_percentage IS NOT NULL;
-- Then drop the old column and add the new one
